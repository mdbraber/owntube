import { and, eq, inArray } from "drizzle-orm";
import { logger } from "@/lib/logger";
import {
  mergeVideosByIdPreferNewer,
  pickNewestVideoPerChannel,
  publishedSortKey,
} from "@/lib/published-sort-key";
import type { UnifiedVideo } from "@/server/catalog/types";
import type { AppDb } from "@/server/db/client";
import { channelMeta, interactions, watchHistory } from "@/server/db/schema";
import {
  expandScoredPoolWithRelatedCandidates,
  HOME_RELATED_LIMITS,
  HOME_RELATED_LIMITS_DEEP,
  type SubscriptionSeed,
} from "@/server/recommendation/collect-related-candidates";
import { collectTaggedVideoCandidates } from "@/server/recommendation/collect-tagged-candidates";
import { getCollectedVideoIds } from "@/server/recommendation/collected-videos";
import {
  appendRecommendationDebugLog,
  recommendationDebugEnabled,
} from "@/server/recommendation/debug-file-log";
import {
  dailyExploreSeed,
  deterministicColdStartJitter,
} from "@/server/recommendation/deterministic-jitter";
import { maximalMarginalRelevance } from "@/server/recommendation/diversity";
import {
  createPoolInvalidation,
  settlePoolBuild,
} from "@/server/recommendation/pool-invalidation";
import { deriveRecommendationReason } from "@/server/recommendation/reason";
import {
  isLikelyShortVideo,
  isTooOldForRecommendations,
  isUnvettedKeywordSpam,
  keepCandidateForPersonalizedFeed,
  keywordDiscoveryScorePenalty,
  type RecommendationScoreContext,
  scoreCandidateDetail,
} from "@/server/recommendation/scoring";
import { clearShortsRecommendationCacheForUser } from "@/server/recommendation/shorts-recommendation-pool";
import {
  collectUserSignals,
  dislikeCorpusVideoIds,
  type UserSignals,
} from "@/server/recommendation/signals";
import { getSubscribedChannelIds } from "@/server/recommendation/subscribed-channels";
import {
  buildKeywordCorpus,
  buildTasteCorpusTitles,
  readStoredDislikeTitlesOrdered,
  readStoredTitlesForVideos,
} from "@/server/recommendation/taste-corpus";
import {
  buildTfidfModel,
  termFrequencyVector,
} from "@/server/recommendation/tfidf";
import { clearTrendingTailCacheForUser } from "@/server/recommendation/trending-tail-cache";
import type { ScoredVideo } from "@/server/recommendation/types";
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

const RECOMMENDATION_POOL_CACHE_TTL_MS = 600_000;
const recommendationPoolCache = new Map<string, RecommendationPoolCacheEntry>();
const recommendationPoolInFlight = new Map<
  string,
  Promise<RecommendationPoolCacheEntry>
>();
const recommendationPoolInvalidation = createPoolInvalidation();

function recommendationPoolCacheKey(
  userId: number,
  opts: {
    pageSize: number;
    region?: string;
  },
  excludeSubscribed: boolean,
  personalizedOnly: boolean,
): string {
  const region = opts.region ?? "US";
  return `${userId}|${region}|${opts.pageSize}|${excludeSubscribed ? "nosubs" : "subs"}|${personalizedOnly ? "ponly" : "blend"}`;
}

function diversifiedRowToVideo(row: ScoredVideo): UnifiedVideo {
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
}

function diversifiedToVideos(
  entry: RecommendationPoolCacheEntry,
): UnifiedVideo[] {
  return entry.diversified.map(diversifiedRowToVideo);
}

function sliceRecommendationPool(
  entry: RecommendationPoolCacheEntry,
  page: number,
  pageSize: number,
): RecommendationResult {
  const start = (page - 1) * pageSize;
  const pageRows = entry.diversified.slice(start, start + pageSize);
  const hasMore = start + pageRows.length < entry.diversified.length;
  const videos: UnifiedVideo[] = pageRows.map(diversifiedRowToVideo);
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

/**
 * Most recent likes lead (strongest endorsement), then engaged watches, newest
 * first. Kept to a couple of likes: subscription uploads take most related
 * seeds, so a few recent likes no longer steer the whole feed.
 */
const RELATED_HISTORY_LIKE_SEEDS = 2;
export function relatedHistorySeeds(
  signals: Pick<UserSignals, "likedVideoIds" | "recentEngagedVideoIds">,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // `likedVideoIds` preserves insertion order = newest interaction first.
  for (const id of signals.likedVideoIds) {
    if (out.length >= RELATED_HISTORY_LIKE_SEEDS) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of signals.recentEngagedVideoIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Related-expansion seeds from subscriptions: the freshest upload of each
 * subscribed channel paged this build, newest first. Watched uploads are fine
 * seeds (the seed itself is never shown); disliked ones are not.
 */
export function subscriptionRelatedSeeds(
  candidates: readonly { video: UnifiedVideo; source: string }[],
  opts: {
    nowSec: number;
    excludeSeedIds: ReadonlySet<string>;
    blockedChannelIds: ReadonlySet<string>;
  },
): SubscriptionSeed[] {
  const newestByChannel = new Map<string, UnifiedVideo>();
  for (const { video, source } of candidates) {
    if (!source.startsWith("subscription:")) continue;
    const channelId = source.slice("subscription:".length);
    if (!video.videoId || opts.excludeSeedIds.has(video.videoId)) continue;
    if (opts.blockedChannelIds.has(channelId)) continue;
    if (isLikelyShortVideo(video)) continue;
    if (isTooOldForRecommendations(video, opts.nowSec)) continue;
    const prev = newestByChannel.get(channelId);
    if (
      !prev ||
      publishedSortKey(video, opts.nowSec) > publishedSortKey(prev, opts.nowSec)
    ) {
      newestByChannel.set(channelId, video);
    }
  }
  return [...newestByChannel.values()]
    .sort(
      (a, b) =>
        publishedSortKey(b, opts.nowSec) - publishedSortKey(a, opts.nowSec),
    )
    .map((v) => ({ videoId: v.videoId, channelName: v.channelName }));
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
  clearTrendingTailCacheForUser(userId);
  recommendationPoolInvalidation.invalidate(userId);
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
  },
): Promise<{ videos: UnifiedVideo[]; coldStart: boolean }> {
  const entry = await ensureRecommendationPool(db, userId, opts);
  return {
    videos: diversifiedToVideos(entry),
    coldStart: entry.coldStart,
  };
}

/** Maps a raw `candidateSource` (e.g. `history_channel:UC123`) to its broad kind. */
function candidateSourceKind(source: string | undefined): string {
  if (!source) return "other";
  const i = source.indexOf(":");
  const head = i === -1 ? source : source.slice(0, i);
  if (head === "trending_channel_head") return "trending";
  return head;
}

export type RecommendationInsights = {
  coldStart: boolean;
  poolSize: number;
  /** Where the pooled candidates came from, most common first. */
  sourceComposition: { kind: string; count: number }[];
  /** Taste terms driving topic-matched rows, most frequent first. */
  topTopics: { term: string; count: number }[];
  /** Head of the diversified pool with its provenance and explanation. */
  topVideos: {
    videoId: string;
    title: string;
    channelName?: string;
    channelId?: string;
    sourceKind: string;
    reason: ScoredVideo["recommendationReason"];
  }[];
};

/**
 * Read-only transparency view of the personalized pool: source mix, dominant
 * taste topics, and the current head of the feed. Reuses the per-user pool
 * cache (~90s), so it is cheap to call alongside the home feed.
 */
export async function getRecommendationInsights(
  db: AppDb,
  userId: number,
  opts: {
    region?: string;
    topVideoCount?: number;
    topTopicCount?: number;
  } = {},
): Promise<RecommendationInsights> {
  const entry = await ensureRecommendationPool(db, userId, {
    pageSize: 24,
    region: opts.region,
  });
  const pool = entry.diversified;

  const sourceCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  for (const row of pool) {
    const kind = candidateSourceKind(row.candidateSource);
    sourceCounts.set(kind, (sourceCounts.get(kind) ?? 0) + 1);
    const reason = row.recommendationReason;
    if (reason?.kind === "topic" && reason.terms) {
      for (const term of reason.terms) {
        const t = term.trim().toLowerCase();
        if (t) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
      }
    }
  }

  const sourceComposition = [...sourceCounts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
  const topTopics = [...topicCounts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, opts.topTopicCount ?? 24);
  const topVideos = pool.slice(0, opts.topVideoCount ?? 12).map((row) => ({
    videoId: row.videoId,
    title: row.title,
    channelName: row.channelName,
    channelId: row.channelId,
    sourceKind: candidateSourceKind(row.candidateSource),
    reason: row.recommendationReason,
  }));

  return {
    coldStart: entry.coldStart,
    poolSize: pool.length,
    sourceComposition,
    topTopics,
    topVideos,
  };
}

async function ensureRecommendationPool(
  db: AppDb,
  userId: number,
  opts: {
    pageSize: number;
    region?: string;
  },
): Promise<RecommendationPoolCacheEntry> {
  // Read here (not just in the builder) so the flags participate in the cache
  // key — toggling one rebuilds the pool without an explicit invalidation.
  const flagSettings = getUserSettings(db, userId);
  const excludeSubscribed = flagSettings.excludeSubscribedFromRecommendations;
  const personalizedOnly = flagSettings.personalizedFeedOnly;
  const cacheKey = recommendationPoolCacheKey(
    userId,
    opts,
    excludeSubscribed,
    personalizedOnly,
  );
  const now = Date.now();
  const cached = recommendationPoolCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const inFlight = recommendationPoolInFlight.get(cacheKey);
  if (inFlight) {
    if (cached) return cached;
    const pool = await inFlight;
    if (pool.expiresAt > Date.now()) {
      return pool;
    }
  }

  const stillCurrent = recommendationPoolInvalidation.snapshot(userId);
  const task = (async (): Promise<RecommendationPoolCacheEntry> => {
    const watchedRows = db
      .select({ videoId: watchHistory.videoId })
      .from(watchHistory)
      .where(
        and(eq(watchHistory.userId, userId), eq(watchHistory.isDeleted, 0)),
      )
      .limit(10_000)
      .all();
    const excludedVideoIds = new Set(watchedRows.map((r) => r.videoId));

    const signals = collectUserSignals(db, userId, { excludeShorts: true });
    for (const id of signals.dislikedVideoIds) {
      excludedVideoIds.add(id);
    }
    // Videos already in the user's queue, saved list, or playlists are things
    // they've already found — hold them out of recommendations so the feed
    // surfaces things they'd otherwise not see. (They still shape taste below.)
    for (const id of getCollectedVideoIds(db, userId)) {
      excludedVideoIds.add(id);
    }
    const region = opts.region ?? "US";
    const userSettings = getUserSettings(db, userId);
    const {
      tagged: taggedCandidates,
      recentCoverageByChannel,
      coldStart,
      needTrendingBlend,
      canBuildFromHistory,
      historyOnlyUnique,
      trendingWarning,
    } = await collectTaggedVideoCandidates(db, userId, {
      region,
      signals,
      tasteKeywords: userSettings.tasteKeywords,
    });

    const nowSec = Math.floor(Date.now() / 1000);
    // Subscriptions are the centre of the home feed: they seed related
    // expansion, form their own taste centroid and count as interest channels.
    const allSubscribedChannelIds = getSubscribedChannelIds(db, userId);
    const scoreContext: RecommendationScoreContext = {
      recentCoverageByChannel,
      exploreSeed: dailyExploreSeed(userId, nowSec),
      // With discovery mode on, subscribed uploads are stripped below, so the
      // subscription lift only applies when they may appear in the feed.
      subscribedChannelIds: userSettings.excludeSubscribedFromRecommendations
        ? undefined
        : allSubscribedChannelIds,
    };

    const blockedRecommendationChannels = new Set(
      userSettings.blockedRecommendationChannels,
    );
    // Opt-in "discovery mode": the subscribed channels' *own* uploads are
    // stripped from the final output below, since those already live in the
    // Subscriptions feed; they still seed related expansion and the taste
    // centroid. Null when the setting is off.
    const subscribedChannelIds =
      userSettings.excludeSubscribedFromRecommendations
        ? allSubscribedChannelIds
        : null;
    const { byId, sourceByVideoId } = mergeVideosByIdPreferNewer(
      taggedCandidates,
      nowSec,
    );
    /**
     * Three newest unwatched uploads per channel: newest-first so TF-IDF
     * cannot bury a fresh upload under an older highlights row, and a few
     * rather than one so a channel the user actually watches can hold a slot
     * on the first page and more deeper down (MMR keeps them apart).
     */
    const poolVideoIds = [...byId.keys()];
    const ignoredVideoIds = new Set(
      poolVideoIds.length > 0
        ? db
            .select({ videoId: interactions.videoId })
            .from(interactions)
            .where(
              and(
                eq(interactions.userId, userId),
                eq(interactions.type, "ignore"),
                inArray(interactions.videoId, poolVideoIds),
              ),
            )
            .all()
            .map((r) => r.videoId)
        : [],
    );
    const uniqueRaw = pickNewestVideoPerChannel(
      [...byId.values()].filter(
        (v) =>
          !excludedVideoIds.has(v.videoId) &&
          !ignoredVideoIds.has(v.videoId) &&
          !(v.channelId && blockedRecommendationChannels.has(v.channelId)) &&
          // Applied before the per-channel cut so a dormant channel yields
          // nothing rather than its stale head.
          !isTooOldForRecommendations(v, nowSec),
      ),
      { nowSec, maxPerChannel: 3 },
    );
    const unique = enrichVideosWithStoredChannelAvatars(db, uniqueRaw);
    const tasteVideoIds = Array.from(
      new Set([...signals.likedVideoIds, ...signals.savedVideoIds]),
    );
    const tasteTitles = readStoredTitlesForVideos(db, tasteVideoIds, 72);
    const keywordCorpus = buildKeywordCorpus(userSettings.tasteKeywords);
    // Recent subscribed uploads (watched or not) form their own taste centroid
    // so title similarity pulls in content like the subscriptions, including
    // from non-subscribed channels in discovery mode.
    const subscriptionTitles = Array.from(
      new Set(
        taggedCandidates
          .filter(
            ({ video, source }) =>
              source.startsWith("subscription:") &&
              !signals.dislikedVideoIds.has(video.videoId) &&
              !isTooOldForRecommendations(video, nowSec),
          )
          .map(({ video }) => video.title),
      ),
    ).slice(0, 144);
    const poolTitles = unique.map((v) => v.title).slice(0, 200);
    const corpusTitles = buildTasteCorpusTitles([
      keywordCorpus,
      tasteTitles,
      subscriptionTitles,
      poolTitles,
    ]);
    const interestChannelIds = new Set([
      ...signals.historyChannelIds,
      ...signals.interactionInterestChannelIds,
      ...allSubscribedChannelIds,
    ]);
    const maxCh = Math.max(1, ...signals.channelWeights.values());
    // Per-interest centroids (keywords / liked+saved titles / subscriptions) so
    // a candidate matching one interest is not diluted by the user's others.
    const tasteModel = buildTfidfModel(corpusTitles, {
      groups:
        subscriptionTitles.length > 0
          ? [keywordCorpus, tasteTitles, subscriptionTitles]
          : [keywordCorpus, tasteTitles],
    });
    const dislikeModel = buildTfidfModel(
      readStoredDislikeTitlesOrdered(db, dislikeCorpusVideoIds(signals), 48),
    );

    // Drop clear keyword SEO spam (stuffed compilations from unknown channels)
    // before scoring — a down-rank is not enough since deep pagination would
    // still surface it.
    const vetted = unique.filter(
      (v) =>
        !isUnvettedKeywordSpam(
          v,
          signals,
          tasteModel,
          sourceByVideoId.get(v.videoId),
          interestChannelIds,
        ),
    );

    let scored: ScoredVideo[] = vetted.map((v) => {
      const detail = scoreCandidateDetail(
        v,
        signals,
        tasteModel,
        maxCh,
        scoreContext,
        dislikeModel,
      );
      const candidateSource = sourceByVideoId.get(v.videoId);
      const keywordPenalty = keywordDiscoveryScorePenalty(
        v,
        signals,
        tasteModel,
        candidateSource,
        interestChannelIds,
      );
      return {
        ...v,
        recommendationReason: deriveRecommendationReason(
          detail.breakdown,
          v,
          tasteModel,
          candidateSource,
        ),
        rawScore: detail.score - keywordPenalty,
        scoreBreakdown: detail.breakdown,
        candidateSource,
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
        // Personalized-only feed drops the trending tail, so lean harder on
        // related expansion to keep the pool long and discovery-rich.
        limits: personalizedOnly
          ? HOME_RELATED_LIMITS_DEEP
          : HOME_RELATED_LIMITS,
        excludeVideoIds: excludedVideoIds,
        historySeedVideoIds: relatedHistorySeeds(signals),
        subscriptionSeeds: subscriptionRelatedSeeds(taggedCandidates, {
          nowSec,
          excludeSeedIds: signals.dislikedVideoIds,
          blockedChannelIds: blockedRecommendationChannels,
        }),
        // Filtered at collection so the related cap counts fresh rows only.
        filterVideo: (v) => !isTooOldForRecommendations(v, nowSec),
        signals,
        tasteModel,
        dislikeModel,
        maxCh,
        scoreContext,
      });
    scored = expandedScored;

    // Discovery mode: now that subscribed uploads have done their job seeding
    // related-expansion and the taste centroid, drop the subscribed channels'
    // own videos (including any pulled back in by expansion) from the output.
    if (subscribedChannelIds) {
      scored = scored.filter(
        (row) => !(row.channelId && subscribedChannelIds.has(row.channelId)),
      );
    }

    if (!coldStart) {
      const filtered = scored.filter((row) =>
        keepCandidateForPersonalizedFeed(
          row,
          signals,
          tasteModel,
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

    if (recommendationDebugEnabled()) {
      const sourceKind = (s?: string): string => {
        if (!s) return "unknown";
        const i = s.indexOf(":");
        return i === -1 ? s : s.slice(0, i);
      };
      const countBySource = (
        rows: { candidateSource?: string }[],
      ): Record<string, number> => {
        const counts: Record<string, number> = {};
        for (const row of rows) {
          const key = sourceKind(row.candidateSource);
          counts[key] = (counts[key] ?? 0) + 1;
        }
        return counts;
      };
      const payload = {
        msg: "recommendation.home_pool",
        userId,
        region,
        coldStart,
        canBuildFromHistory,
        historyOnlyUnique,
        needTrendingBlend,
        trendingWarning: trendingWarning ?? null,
        scoredCount: scored.length,
        diversifiedCount: diversified.length,
        sourcesScored: countBySource(scored),
        sourcesDiversified: countBySource(diversified),
        top: diversified.slice(0, 24).map((row) => ({
          videoId: row.videoId,
          title: clipTitle(row.title),
          channelName: row.channelName ?? null,
          source: row.candidateSource ?? null,
          rawScore: Number(row.rawScore.toFixed(4)),
          reason: row.recommendationReason ?? null,
        })),
      };
      logger.info("recommendation.home_pool", payload);
      await appendRecommendationDebugLog(payload);
    }

    return {
      expiresAt: Date.now() + RECOMMENDATION_POOL_CACHE_TTL_MS,
      diversified,
      coldStart,
    };
  })();
  const settled = settlePoolBuild(
    task,
    cacheKey,
    recommendationPoolCache,
    recommendationPoolInFlight,
    stillCurrent,
  );
  // Stale-while-revalidate: a rebuild can take dozens of upstream fetches when
  // the 10-min channel caches are cold, so an expired pool is served instantly
  // and the fresh one lands in the background for the next load.
  if (cached) {
    settled.catch((error: unknown) => {
      logger.warn("recommendation.pool_refresh_failed", {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return cached;
  }
  return settled;
}

export async function getRecommendations(
  db: AppDb,
  userId: number,
  opts: {
    page: number;
    pageSize: number;
    region?: string;
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
