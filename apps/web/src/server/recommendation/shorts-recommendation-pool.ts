import { stripRestrictedListVideos } from "@/lib/feed-exclude-restricted";
import {
  mergeVideosByIdPreferNewer,
  pickNewestVideoPerChannel,
} from "@/lib/published-sort-key";
import { isStrictShortVideo } from "@/lib/short-video";
import { shortsSearchQueriesForTaste } from "@/lib/shorts-discovery-queries";
import type { AppDb } from "@/server/db/client";
import {
  expandScoredPoolWithRelatedCandidates,
  SHORTS_RELATED_LIMITS,
} from "@/server/recommendation/collect-related-candidates";
import { collectShortsCandidates } from "@/server/recommendation/collect-shorts-candidates";
import {
  dailyExploreSeed,
  deterministicColdStartJitter,
} from "@/server/recommendation/deterministic-jitter";
import { maximalMarginalRelevance } from "@/server/recommendation/diversity";
import {
  keepCandidateForPersonalizedFeed,
  keepShortsDiscoveryCandidate,
  type RecommendationScoreContext,
  scoreCandidateDetail,
  shortsDiscoveryScorePenalty,
} from "@/server/recommendation/scoring";
import {
  loadShortSeenVideoIds,
  loadSoftSeenShortVideoIds,
} from "@/server/recommendation/shorts-seen";
import {
  collectUserSignals,
  dislikeCorpusVideoIds,
} from "@/server/recommendation/signals";
import {
  buildKeywordCorpus,
  buildTasteCorpusTitles,
  readCachedDetailTitlesForVideos,
  readCachedDislikeTitlesOrdered,
} from "@/server/recommendation/taste-corpus";
import {
  buildTfidfModel,
  termFrequencyVector,
} from "@/server/recommendation/tfidf";
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
/**
 * Flat down-rank for shorts seen 45–90 days ago that resurface from the soft
 * window — roughly the freshness gap between a day-old and a month-old short,
 * enough to prefer new content without burying recycled ids.
 */
const SHORTS_SEEN_SOFT_PENALTY = 0.12;
const shortsPoolCache = new Map<string, ShortsPoolCacheEntry>();
const shortsPoolInFlight = new Map<string, Promise<ShortsPoolCacheEntry>>();

function shortsPoolCacheKey(
  userId: number,
  opts: { pageSize: number; region: string; overrides?: ProxySourceOverrides },
): string {
  const piped = (
    opts.overrides?.pipedBaseUrls ?? [opts.overrides?.pipedBaseUrl ?? ""]
  )
    .map((url) => url.trim())
    .filter(Boolean)
    .join(",");
  const invidious = (
    opts.overrides?.invidiousBaseUrls ?? [
      opts.overrides?.invidiousBaseUrl ?? "",
    ]
  )
    .map((url) => url.trim())
    .filter(Boolean)
    .join(",");
  // `shorts seen` is deliberately NOT part of the key: it grows on every scroll
  // and would bust the 90s cache (forcing a full channel-tab refetch) on each
  // short. Hard-window seen filtering happens downstream
  // (`fetchShortsFeedForViewer`); the soft band (45–90d) only changes daily,
  // so baking its penalty into the cached pool is safe.
  return `shorts|${userId}|${opts.region}|${opts.pageSize}|${piped}|${invidious}`;
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
        titleVector: _tv,
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
  const cacheKey = shortsPoolCacheKey(userId, {
    pageSize: opts.pageSize,
    region,
    overrides: opts.overrides,
  });
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
    // A rebuild is already running; with a stale pool on hand, answer from
    // it instead of blocking on the rebuild.
    if (cached) return sliceShortsPool(cached, opts.page, opts.pageSize);
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
    const softSeenShortIds = loadSoftSeenShortVideoIds(db, userId);
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
    const keywordCorpus = buildKeywordCorpus(userSettings.tasteKeywords);
    const preCorpusTitles = buildTasteCorpusTitles(
      [keywordCorpus, tasteTitles],
      120,
    );
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

    const nowSec = Math.floor(Date.now() / 1000);
    const scoreContext: RecommendationScoreContext = {
      recentCoverageByChannel,
      exploreSeed: dailyExploreSeed(userId, nowSec),
    };

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
    const corpusTitles = buildTasteCorpusTitles([preCorpusTitles, poolTitles]);
    const interestChannelIds = new Set([
      ...signals.historyChannelIds,
      ...signals.interactionInterestChannelIds,
    ]);
    const maxCh = Math.max(1, ...signals.channelWeights.values());
    const tasteModel = buildTfidfModel(corpusTitles, {
      groups: [keywordCorpus, tasteTitles],
    });
    const dislikeModel = buildTfidfModel(
      readCachedDislikeTitlesOrdered(db, dislikeCorpusVideoIds(signals), 48),
    );

    let scored: ScoredVideo[] = uniqueRaw.map((v) => {
      const source = sourceByVideoId.get(v.videoId);
      const detail = scoreCandidateDetail(
        v,
        signals,
        tasteModel,
        maxCh,
        scoreContext,
        dislikeModel,
      );
      const penalty = shortsDiscoveryScorePenalty(
        v,
        signals,
        tasteModel,
        source,
        interestChannelIds,
      );
      /** Soft-band recycled shorts may resurface, but fresh content stays ahead. */
      const softSeenPenalty = softSeenShortIds.has(v.videoId)
        ? SHORTS_SEEN_SOFT_PENALTY
        : 0;
      return {
        ...v,
        rawScore: detail.score - penalty - softSeenPenalty,
        scoreBreakdown: detail.breakdown,
        candidateSource: source,
        titleVector: termFrequencyVector(v.title),
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
        tasteModel,
        dislikeModel,
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
          tasteModel,
          interestChannelIds,
        );
      }
      if (coldStart) return true;
      return keepCandidateForPersonalizedFeed(
        row,
        signals,
        tasteModel,
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
  const settled = task
    .then((pool) => {
      shortsPoolCache.set(cacheKey, pool);
      return pool;
    })
    .finally(() => {
      shortsPoolInFlight.delete(cacheKey);
    });

  // Serve-stale-while-revalidate: an expired pool answers instantly while the
  // rebuild above replaces it in the background. Blocking here was the
  // 10-20s "loading shorts" hang - with a 90s TTL, almost every visit paid
  // the full channel-fetch rebuild on its critical path.
  if (cached) {
    settled.catch(() => {});
    return sliceShortsPool(cached, opts.page, opts.pageSize);
  }

  const pool = await settled;
  return sliceShortsPool(pool, opts.page, opts.pageSize);
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
