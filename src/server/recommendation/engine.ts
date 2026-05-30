import { and, eq } from "drizzle-orm";
import { stripRestrictedListVideos } from "@/lib/feed-exclude-restricted";
import { logger } from "@/lib/logger";
import {
  mergeVideosByIdPreferNewer,
  pickNewestVideoPerChannel,
} from "@/lib/published-sort-key";
import type { AppDb } from "@/server/db/client";
import { channelMeta, watchHistory } from "@/server/db/schema";
import {
  expandScoredPoolWithRelatedCandidates,
  HOME_RELATED_LIMITS,
} from "@/server/recommendation/collect-related-candidates";
import { collectTaggedVideoCandidates } from "@/server/recommendation/collect-tagged-candidates";
import {
  appendRecommendationDebugLog,
  recommendationDebugEnabled,
} from "@/server/recommendation/debug-file-log";
import { maximalMarginalRelevance } from "@/server/recommendation/diversity";
import {
  keepCandidateForPersonalizedFeed,
  type RecommendationScoreContext,
  scoreCandidateDetail,
} from "@/server/recommendation/scoring";
import { clearShortsRecommendationCacheForUser } from "@/server/recommendation/shorts-recommendation-pool";
import { collectUserSignals } from "@/server/recommendation/signals";
import { readCachedDetailTitlesForVideos } from "@/server/recommendation/taste-corpus";
import type { ScoredVideo } from "@/server/recommendation/types";
import type { ProxySourceOverrides } from "@/server/services/proxy";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import { getUserSettings } from "@/server/settings/profile";

export type RecommendationResult = {
  videos: UnifiedVideo[];
  coldStart: boolean;
  hasMore: boolean;
  /** Pages available from the personalized pool (for trending tail pagination). */
  personalizedPageCount: number;
};

type RecommendationPoolCacheEntry = {
  expiresAt: number;
  coldStart: boolean;
  diversified: ScoredVideo[];
};

const RECOMMENDATION_POOL_CACHE_TTL_MS = 90_000;
const recommendationPoolCache = new Map<string, RecommendationPoolCacheEntry>();
const recommendationPoolInFlight = new Map<
  string,
  Promise<RecommendationPoolCacheEntry>
>();

function deterministicUnitInterval(seed: string): number {
  // FNV-1a 32-bit hash for stable pseudo-random ordering.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Convert to [0, 1).
  return (h >>> 0) / 0x1_0000_0000;
}

function deterministicColdStartJitter(userId: number, videoId: string): number {
  const u = deterministicUnitInterval(`${userId}:${videoId}`);
  return (u - 0.5) * 0.08;
}

function recommendationPoolCacheKey(
  userId: number,
  opts: {
    pageSize: number;
    region?: string;
    overrides?: ProxySourceOverrides;
  },
): string {
  const region = opts.region ?? "US";
  const piped = opts.overrides?.pipedBaseUrl?.trim() ?? "";
  const invidious = opts.overrides?.invidiousBaseUrl?.trim() ?? "";
  return `${userId}|${region}|${opts.pageSize}|${piped}|${invidious}`;
}

function diversifiedRowToVideo(row: ScoredVideo): UnifiedVideo {
  const {
    rawScore: _r,
    preMmrRawScore: _p,
    scoreBreakdown: _b,
    candidateSource: _c,
    coldStartJitter: _j,
    ...video
  } = row;
  return video;
}

function diversifiedToVideos(
  entry: RecommendationPoolCacheEntry,
): UnifiedVideo[] {
  return stripRestrictedListVideos(
    entry.diversified.map(diversifiedRowToVideo),
  );
}

function sliceRecommendationPool(
  entry: RecommendationPoolCacheEntry,
  page: number,
  pageSize: number,
): RecommendationResult {
  const start = (page - 1) * pageSize;
  const pageRows = entry.diversified.slice(start, start + pageSize);
  const hasMore = start + pageRows.length < entry.diversified.length;
  const videos: UnifiedVideo[] = stripRestrictedListVideos(
    pageRows.map(diversifiedRowToVideo),
  );
  const personalizedPageCount = Math.max(
    1,
    Math.ceil(entry.diversified.length / pageSize),
  );
  return {
    videos,
    coldStart: entry.coldStart,
    hasMore,
    personalizedPageCount,
  };
}

function clipTitle(title: string, max = 80): string {
  const t = title.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function isMissingChannelMetaTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.toLowerCase().includes("no such table: channel_meta");
}

export function enrichVideosWithStoredChannelAvatars(
  db: AppDb,
  videos: UnifiedVideo[],
): UnifiedVideo[] {
  const channelIds = Array.from(
    new Set(
      videos
        .map((v) => v.channelId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  if (channelIds.length === 0) return videos;

  let rows: { channelId: string; avatarUrl: string | null }[];
  try {
    rows = db
      .select({
        channelId: channelMeta.channelId,
        avatarUrl: channelMeta.avatarUrl,
      })
      .from(channelMeta)
      .all();
  } catch (error) {
    if (isMissingChannelMetaTableError(error)) return videos;
    throw error;
  }
  if (rows.length === 0) return videos;

  const byChannelId = new Map<string, string>();
  for (const row of rows) {
    if (!row.channelId || !row.avatarUrl) continue;
    byChannelId.set(row.channelId, row.avatarUrl);
  }
  if (byChannelId.size === 0) return videos;

  return videos.map((v) => {
    if (v.channelAvatarUrl) return v;
    if (!v.channelId) return v;
    const avatar = byChannelId.get(v.channelId);
    if (!avatar) return v;
    return { ...v, channelAvatarUrl: avatar };
  });
}

export function clearRecommendationCachesForUser(userId?: number): void {
  clearShortsRecommendationCacheForUser(userId);
  if (typeof userId !== "number" || !Number.isFinite(userId) || userId <= 0) {
    recommendationPoolCache.clear();
    recommendationPoolInFlight.clear();
    return;
  }
  const prefix = `${userId}|`;
  for (const key of recommendationPoolCache.keys()) {
    if (key.startsWith(prefix)) recommendationPoolCache.delete(key);
  }
  for (const key of recommendationPoolInFlight.keys()) {
    if (key.startsWith(prefix)) recommendationPoolInFlight.delete(key);
  }
}

export async function getPersonalizedFeedVideos(
  db: AppDb,
  userId: number,
  opts: {
    pageSize: number;
    region?: string;
    overrides?: ProxySourceOverrides;
  },
): Promise<{ videos: UnifiedVideo[]; coldStart: boolean }> {
  const entry = await ensureRecommendationPool(db, userId, opts);
  return {
    videos: diversifiedToVideos(entry),
    coldStart: entry.coldStart,
  };
}

async function ensureRecommendationPool(
  db: AppDb,
  userId: number,
  opts: {
    pageSize: number;
    region?: string;
    overrides?: ProxySourceOverrides;
  },
): Promise<RecommendationPoolCacheEntry> {
  const cacheKey = recommendationPoolCacheKey(userId, opts);
  const now = Date.now();
  const cached = recommendationPoolCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const inFlight = recommendationPoolInFlight.get(cacheKey);
  if (inFlight) {
    const pool = await inFlight;
    if (pool.expiresAt > Date.now()) {
      return pool;
    }
  }

  const task = (async (): Promise<RecommendationPoolCacheEntry> => {
    const watchedRows = db
      .select({ videoId: watchHistory.videoId })
      .from(watchHistory)
      .where(
        and(eq(watchHistory.userId, userId), eq(watchHistory.isDeleted, 0)),
      )
      .limit(10_000)
      .all();
    const watchedEver = new Set(watchedRows.map((r) => r.videoId));

    const signals = collectUserSignals(db, userId);
    for (const id of signals.dislikedVideoIds) {
      watchedEver.add(id);
    }
    const region = opts.region ?? "US";
    const {
      tagged: taggedCandidates,
      recentCoverageByChannel,
      coldStart,
    } = await collectTaggedVideoCandidates(db, userId, {
      region,
      overrides: opts.overrides,
      signals,
    });

    const scoreContext: RecommendationScoreContext = {
      recentCoverageByChannel,
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const userSettings = getUserSettings(db, userId);
    const blockedRecommendationChannels = new Set(
      userSettings.blockedRecommendationChannels,
    );
    const { byId, sourceByVideoId } = mergeVideosByIdPreferNewer(
      taggedCandidates,
      nowSec,
    );
    /** One unwatched “head” per channel so TF-IDF cannot bury a newer upload under an older highlights row. */
    const uniqueRaw = pickNewestVideoPerChannel(
      stripRestrictedListVideos(
        [...byId.values()].filter(
          (v) =>
            !watchedEver.has(v.videoId) &&
            !(v.channelId && blockedRecommendationChannels.has(v.channelId)),
        ),
      ),
      { nowSec, maxPerChannel: 1 },
    );
    const unique = enrichVideosWithStoredChannelAvatars(db, uniqueRaw);
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
    const poolTitles = unique.map((v) => v.title).slice(0, 200);
    const corpusSeen = new Set<string>();
    const corpusTitles: string[] = [];
    for (const t of [...keywordCorpus, ...tasteTitles, ...poolTitles]) {
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

    let scored: ScoredVideo[] = unique.map((v) => {
      const detail = scoreCandidateDetail(
        v,
        signals,
        corpusTitles,
        maxCh,
        scoreContext,
      );
      return {
        ...v,
        rawScore: detail.score,
        scoreBreakdown: detail.breakdown,
        candidateSource: sourceByVideoId.get(v.videoId),
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
        limits: HOME_RELATED_LIMITS,
        overrides: opts.overrides,
        excludeVideoIds: watchedEver,
        signals,
        corpusTitles,
        maxCh,
        scoreContext,
      });
    scored = expandedScored;

    if (!coldStart) {
      const filtered = scored.filter((row) =>
        keepCandidateForPersonalizedFeed(
          row,
          signals,
          corpusTitles,
          interestChannelIds,
        ),
      );
      if (filtered.length >= Math.max(opts.pageSize * 2, 16)) {
        scored = filtered;
      }
    }

    /** Larger pool so pagination lasts longer before hasMore ends. */
    const poolSize = Math.min(360, scored.length);
    const diversified = maximalMarginalRelevance(
      scored.slice(0, poolSize),
      poolSize,
    );

    return {
      expiresAt: Date.now() + RECOMMENDATION_POOL_CACHE_TTL_MS,
      diversified,
      coldStart,
    };
  })();
  recommendationPoolInFlight.set(cacheKey, task);
  try {
    const pool = await task;
    recommendationPoolCache.set(cacheKey, pool);
    return pool;
  } finally {
    recommendationPoolInFlight.delete(cacheKey);
  }
}

export async function getRecommendations(
  db: AppDb,
  userId: number,
  opts: {
    page: number;
    pageSize: number;
    region?: string;
    overrides?: ProxySourceOverrides;
  },
): Promise<RecommendationResult> {
  const entry = await ensureRecommendationPool(db, userId, opts);
  const result = sliceRecommendationPool(entry, opts.page, opts.pageSize);

  if (recommendationDebugEnabled()) {
    const start = (opts.page - 1) * opts.pageSize;
    const pageRows = entry.diversified.slice(start, start + opts.pageSize);
    const items = pageRows.map((row, i) => ({
      feedRank: start + i,
      mmrPoolIndex: entry.diversified.indexOf(row),
      videoId: row.videoId,
      title: clipTitle(row.title),
      channelId: row.channelId ?? null,
      candidateSource: row.candidateSource ?? null,
      rankScore: row.preMmrRawScore ?? row.rawScore,
      mmrNormalizedRelevance: row.rawScore,
      coldStartJitter: row.coldStartJitter ?? 0,
      score: row.scoreBreakdown?.components ?? null,
      inputs: row.scoreBreakdown?.inputs ?? null,
    }));
    const payload = {
      msg: "recommendation.debug_page",
      userId,
      page: opts.page,
      pageSize: opts.pageSize,
      items,
    };
    logger.info("recommendation.debug_page", payload);
    await appendRecommendationDebugLog(payload);
  }

  return result;
}
