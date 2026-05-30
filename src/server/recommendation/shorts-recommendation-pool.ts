import { stripRestrictedListVideos } from "@/lib/feed-exclude-restricted";
import {
  mergeVideosByIdPreferNewer,
  pickNewestVideoPerChannel,
} from "@/lib/published-sort-key";
import { isStrictShortVideo } from "@/lib/short-video";
import type { AppDb } from "@/server/db/client";
import {
  expandScoredPoolWithRelatedCandidates,
  SHORTS_RELATED_LIMITS,
} from "@/server/recommendation/collect-related-candidates";
import { collectShortsCandidates } from "@/server/recommendation/collect-shorts-candidates";
import { maximalMarginalRelevance } from "@/server/recommendation/diversity";
import { shortsSearchQueriesForTaste } from "@/lib/shorts-discovery-queries";
import {
  keepCandidateForPersonalizedFeed,
  keepShortsDiscoveryCandidate,
  type RecommendationScoreContext,
  scoreCandidateDetail,
  shortsDiscoveryScorePenalty,
} from "@/server/recommendation/scoring";
import { loadShortSeenVideoIds } from "@/server/recommendation/shorts-seen";
import { collectUserSignals } from "@/server/recommendation/signals";
import { readCachedDetailTitlesForVideos } from "@/server/recommendation/taste-corpus";
import type { ScoredVideo } from "@/server/recommendation/types";
import { loadWatchedVideoIdsForRecommendations } from "@/server/recommendation/watched-videos";
import type { ProxySourceOverrides } from "@/server/services/proxy";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import { getUserSettings } from "@/server/settings/profile";

export type ShortsRecommendationResult = {
  videos: UnifiedVideo[];
  coldStart: boolean;
  hasMore: boolean;
};

type ShortsPoolCacheEntry = {
  expiresAt: number;
  coldStart: boolean;
  diversified: ScoredVideo[];
};

const SHORTS_POOL_CACHE_TTL_MS = 90_000;
const shortsPoolCache = new Map<string, ShortsPoolCacheEntry>();
const shortsPoolInFlight = new Map<string, Promise<ShortsPoolCacheEntry>>();

function deterministicColdStartJitter(userId: number, videoId: string): number {
  let h = 0x811c9dc5;
  const seed = `${userId}:${videoId}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 0x1_0000_0000 - 0.5) * 0.08;
}

function shortsPoolCacheKey(
  userId: number,
  opts: { pageSize: number; region: string; overrides?: ProxySourceOverrides },
  shortsSeenCount: number,
): string {
  const piped = opts.overrides?.pipedBaseUrl?.trim() ?? "";
  const invidious = opts.overrides?.invidiousBaseUrl?.trim() ?? "";
  return `shorts|${userId}|${opts.region}|${opts.pageSize}|${piped}|${invidious}|seen:${shortsSeenCount}`;
}

function sliceShortsPool(
  entry: ShortsPoolCacheEntry,
  page: number,
  pageSize: number,
): ShortsRecommendationResult {
  const start = (page - 1) * pageSize;
  const pageRows = entry.diversified.slice(start, start + pageSize);
  const hasMore = start + pageRows.length < entry.diversified.length;
  const videos: UnifiedVideo[] = stripRestrictedListVideos(
    pageRows.map((row) => {
      const {
        rawScore: _r,
        preMmrRawScore: _p,
        scoreBreakdown: _b,
        candidateSource: _c,
        coldStartJitter: _j,
        ...video
      } = row;
      return video;
    }),
  );
  return {
    videos,
    coldStart: entry.coldStart,
    hasMore,
  };
}

/**
 * Personalized Shorts: same scoring / MMR / taste corpus as home, but candidates
 * are Shorts from your channels (not long-form home rows filtered to ≤60s).
 */
export async function getShortsRecommendations(
  db: AppDb,
  userId: number,
  opts: {
    page: number;
    pageSize: number;
    region?: string;
    overrides?: ProxySourceOverrides;
    additionalExcludeVideoIds?: readonly string[];
    forcePoolRefresh?: boolean;
    /** Limits channel tab fetches when building the pool (home shelf). */
    maxChannels?: number;
  },
): Promise<ShortsRecommendationResult> {
  const region = opts.region ?? "US";
  const shortsSeenCount = loadShortSeenVideoIds(db, userId).size;
  const cacheKey = shortsPoolCacheKey(
    userId,
    {
      pageSize: opts.pageSize,
      region,
      overrides: opts.overrides,
    },
    shortsSeenCount,
  );
  const now = Date.now();
  if (opts.forcePoolRefresh) {
    shortsPoolCache.delete(cacheKey);
    shortsPoolInFlight.delete(cacheKey);
  }
  const cached = shortsPoolCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return sliceShortsPool(cached, opts.page, opts.pageSize);
  }

  const inFlight = shortsPoolInFlight.get(cacheKey);
  if (inFlight) {
    const pool = await inFlight;
    if (pool.expiresAt > Date.now()) {
      return sliceShortsPool(pool, opts.page, opts.pageSize);
    }
  }

  const task = (async (): Promise<ShortsPoolCacheEntry> => {
    const watchedEver = loadWatchedVideoIdsForRecommendations(db, userId);
    for (const id of loadShortSeenVideoIds(db, userId)) {
      watchedEver.add(id);
    }
    if (opts.additionalExcludeVideoIds) {
      for (const id of opts.additionalExcludeVideoIds) {
        const trimmed = id.trim();
        if (trimmed.length > 0) watchedEver.add(trimmed);
      }
    }
    const signals = collectUserSignals(db, userId);
    const userSettings = getUserSettings(db, userId);
    const blocked = new Set(userSettings.blockedRecommendationChannels);

    const tasteVideoIds = Array.from(
      new Set([...signals.likedVideoIds, ...signals.savedVideoIds]),
    );
    const tasteTitles = readCachedDetailTitlesForVideos(db, tasteVideoIds, 72);
    const keywordCorpus: string[] = [];
    for (const kw of userSettings.tasteKeywords) {
      const k = kw.trim();
      if (!k) continue;
      keywordCorpus.push(k, k, k);
    }
    const preCorpusTitles: string[] = [];
    const preSeen = new Set<string>();
    for (const t of [...keywordCorpus, ...tasteTitles]) {
      const low = t.trim().toLowerCase();
      if (!low || preSeen.has(low)) continue;
      preSeen.add(low);
      preCorpusTitles.push(t.trim());
      if (preCorpusTitles.length >= 120) break;
    }
    const tasteDiscoveryQueries = shortsSearchQueriesForTaste(
      preCorpusTitles,
      region,
    );

    const { tagged, recentCoverageByChannel, coldStart } =
      await collectShortsCandidates(db, userId, {
        region,
        overrides: opts.overrides,
        signals,
        tasteDiscoveryQueries,
        blockedChannelIds: blocked,
        maxChannels: opts.maxChannels,
      });

    const scoreContext: RecommendationScoreContext = {
      recentCoverageByChannel,
    };
    const nowSec = Math.floor(Date.now() / 1000);

    const { byId, sourceByVideoId } = mergeVideosByIdPreferNewer(
      tagged,
      nowSec,
    );
    const uniqueRaw = pickNewestVideoPerChannel(
      stripRestrictedListVideos(
        [...byId.values()].filter(
          (v) =>
            !watchedEver.has(v.videoId) &&
            !(v.channelId && blocked.has(v.channelId)),
        ),
      ),
      { nowSec, maxPerChannel: 3 },
    );

    const poolTitles = uniqueRaw.map((v) => v.title).slice(0, 200);
    const corpusSeen = new Set<string>();
    const corpusTitles: string[] = [];
    for (const t of [...preCorpusTitles, ...poolTitles]) {
      const low = t.trim().toLowerCase();
      if (!low || corpusSeen.has(low)) continue;
      corpusSeen.add(low);
      corpusTitles.push(t.trim());
      if (corpusTitles.length >= 240) break;
    }
    const interestChannelIds = new Set([
      ...signals.historyChannelIds,
      ...signals.interactionInterestChannelIds,
    ]);
    const maxCh = Math.max(1, ...signals.channelWeights.values());

    let scored: ScoredVideo[] = uniqueRaw.map((v) => {
      const source = sourceByVideoId.get(v.videoId);
      const detail = scoreCandidateDetail(
        v,
        signals,
        corpusTitles,
        maxCh,
        scoreContext,
      );
      const penalty = shortsDiscoveryScorePenalty(
        v,
        signals,
        corpusTitles,
        source,
        interestChannelIds,
      );
      return {
        ...v,
        rawScore: detail.score - penalty,
        scoreBreakdown: detail.breakdown,
        candidateSource: source,
      };
    });

    if (coldStart) {
      scored = scored
        .map((s) => {
          const jitter = deterministicColdStartJitter(userId, s.videoId);
          return {
            ...s,
            rawScore: s.rawScore + jitter,
            coldStartJitter: jitter,
          };
        })
        .sort((a, b) => b.rawScore - a.rawScore);
    } else {
      scored.sort((a, b) => b.rawScore - a.rawScore);
    }

    const { scored: expandedScored } =
      await expandScoredPoolWithRelatedCandidates({
        db,
        scored,
        coldStart,
        limits: SHORTS_RELATED_LIMITS,
        overrides: opts.overrides,
        excludeVideoIds: watchedEver,
        signals,
        corpusTitles,
        maxCh,
        scoreContext,
        minScoredForExpansion: 6,
        filterVideo: isStrictShortVideo,
      });
    scored = expandedScored;

    const filtered = scored.filter((row) => {
      if (row.candidateSource === "shorts_discovery") {
        return keepShortsDiscoveryCandidate(
          row,
          signals,
          corpusTitles,
          interestChannelIds,
        );
      }
      if (coldStart) return true;
      return keepCandidateForPersonalizedFeed(
        row,
        signals,
        corpusTitles,
        interestChannelIds,
      );
    });
    if (filtered.length >= Math.max(opts.pageSize * 2, 12)) {
      scored = filtered;
    }

    const poolSize = Math.min(360, scored.length);
    const diversified = maximalMarginalRelevance(
      scored.slice(0, poolSize),
      poolSize,
    );

    return {
      expiresAt: Date.now() + SHORTS_POOL_CACHE_TTL_MS,
      diversified,
      coldStart,
    };
  })();

  shortsPoolInFlight.set(cacheKey, task);
  try {
    const pool = await task;
    shortsPoolCache.set(cacheKey, pool);
    return sliceShortsPool(pool, opts.page, opts.pageSize);
  } finally {
    shortsPoolInFlight.delete(cacheKey);
  }
}

export function clearShortsRecommendationCacheForUser(userId?: number): void {
  if (typeof userId !== "number" || !Number.isFinite(userId) || userId <= 0) {
    shortsPoolCache.clear();
    shortsPoolInFlight.clear();
    return;
  }
  const prefix = `shorts|${userId}|`;
  for (const key of shortsPoolCache.keys()) {
    if (key.startsWith(prefix)) shortsPoolCache.delete(key);
  }
  for (const key of shortsPoolInFlight.keys()) {
    if (key.startsWith(prefix)) shortsPoolInFlight.delete(key);
  }
}
