import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { logger } from "@/lib/logger";
import {
  readFreshCacheRow,
  readLatestCacheRow,
  writeCache,
} from "@/server/cache/video-cache";
import { fetchTrendingVideos } from "@/server/catalog";
import {
  trendingVideoCategorySchema,
  type UnifiedVideo,
  unifiedVideoSchema,
} from "@/server/catalog/types";
import type { AppDb } from "@/server/db/client";
import { interactions, watchHistory } from "@/server/db/schema";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { getPersonalizedFeedVideos } from "@/server/recommendation/engine";
import { settlePoolBuild } from "@/server/recommendation/pool-invalidation";
import { trendingTailRelevance } from "@/server/recommendation/scoring";
import {
  collectUserSignals,
  type UserSignals,
} from "@/server/recommendation/signals";
import { getSubscribedChannelIds } from "@/server/recommendation/subscribed-channels";
import {
  buildKeywordCorpus,
  buildTasteCorpusTitles,
  readStoredTitlesForVideos,
} from "@/server/recommendation/taste-corpus";
import {
  buildTfidfModel,
  type TfidfModel,
} from "@/server/recommendation/tfidf";
import {
  type TrendingTailCacheEntry,
  trendingTailPoolCache,
  trendingTailPoolInFlight,
  trendingTailPoolInvalidation,
} from "@/server/recommendation/trending-tail-cache";
import {
  getUserSettings,
  normalizeTrendingRegionStored,
  withoutBlockedChannels,
} from "@/server/settings/profile";
import { publicProcedure, router } from "@/server/trpc/init";

const homeInputSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    /** Offset into the merged home stream (items already shown). Set by `useInfiniteQuery`. */
    cursor: z.number().int().min(0).nullish(),
    pageSize: z.number().int().min(1).max(48).default(24),
    region: z.string().length(2).optional(),
    /** When set, home uses regional trending for this Invidious category (any user). */
    category: trendingVideoCategorySchema,
  })
  .optional();

const TRENDING_TAIL_CACHE_TTL_MS = 90_000;

function trendingTailCacheKey(
  userId: number | null,
  region: string,
  excludeSubscribed: boolean,
): string {
  return `tail|${userId ?? "anon"}|${region}|${excludeSubscribed ? 1 : 0}`;
}

/**
 * Orders the trending tail by taste relevance, strongest first, without
 * dropping anything: the feed keeps extending as far as trending goes, but
 * widens as it drags on — on-taste rows up top, off-taste regional trending
 * sinking toward the deep end. Stable sort, so equally-relevant rows keep their
 * upstream trending order.
 */
export function orderTrendingTailByTaste(
  pool: UnifiedVideo[],
  signals: UserSignals,
  tasteModel: TfidfModel,
  interestChannelIds: ReadonlySet<string>,
): UnifiedVideo[] {
  return pool
    .map((video, index) => ({
      video,
      index,
      score: trendingTailRelevance(
        video,
        signals,
        tasteModel,
        interestChannelIds,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.video);
}

async function buildTrendingTailPoolUncached(
  db: AppDb,
  userId: number | null,
  region: string,
  excludeSubscribed: boolean,
) {
  const trending = await fetchTrendingVideos({ region, limit: 200 });
  // Drop live/upcoming streams: regional trending leaks foreign 24/7 live TV
  // (e.g. news channels) that matches no interest and never ends — pure noise in
  // a personalized home tail.
  const withoutLive = trending.videos.filter((v) => !v.isLive && !v.isUpcoming);
  let pool = withoutLive;
  if (userId) {
    const seenRows = db
      .select({ videoId: watchHistory.videoId })
      .from(watchHistory)
      .where(
        and(eq(watchHistory.userId, userId), eq(watchHistory.isDeleted, 0)),
      )
      .limit(10_000)
      .all();
    const seen = new Set(seenRows.map((r) => r.videoId));
    pool = pool.filter((v) => !seen.has(v.videoId));

    const userSettings = getUserSettings(db, userId);

    // "Don't recommend this channel" must hold in the trending tail too — the
    // personalized head already drops these, and the whole recommended feed
    // should honor the block. The tail cache is cleared on block so it lands
    // immediately rather than after the 90s TTL.
    const blockedChannels = new Set(userSettings.blockedRecommendationChannels);
    if (blockedChannels.size > 0) {
      pool = pool.filter(
        (v) => !(v.channelId && blockedChannels.has(v.channelId)),
      );
    }

    // Opt-in: keep already-subscribed channels out of the trending tail too, so
    // the whole recommended feed honors the setting (not just the personalized
    // head).
    if (excludeSubscribed) {
      const subscribed = getSubscribedChannelIds(db, userId);
      pool = pool.filter((v) => !(v.channelId && subscribed.has(v.channelId)));
    }

    // Taste-sort the tail for users past cold start. DB + in-memory only (the
    // TF-IDF corpus is ≤240 short docs); the 90s per-user cache amortizes it.
    const signals = collectUserSignals(db, userId, { excludeShorts: true });
    if (signals.totalWatches >= 14) {
      const keywordCorpus = buildKeywordCorpus(userSettings.tasteKeywords);
      const tasteVideoIds = Array.from(
        new Set([...signals.likedVideoIds, ...signals.savedVideoIds]),
      );
      const tasteTitles = readStoredTitlesForVideos(db, tasteVideoIds, 72);
      const poolTitles = pool.map((v) => v.title).slice(0, 200);
      const tasteModel = buildTfidfModel(
        buildTasteCorpusTitles([keywordCorpus, tasteTitles, poolTitles]),
        { groups: [keywordCorpus, tasteTitles] },
      );
      const interestChannelIds = new Set([
        ...signals.historyChannelIds,
        ...signals.interactionInterestChannelIds,
      ]);
      pool = orderTrendingTailByTaste(
        pool,
        signals,
        tasteModel,
        interestChannelIds,
      );
    }
  }
  return pool;
}

async function buildTrendingTailPool(
  db: AppDb,
  userId: number | null,
  region: string,
  excludeSubscribed: boolean,
) {
  const cacheKey = trendingTailCacheKey(userId, region, excludeSubscribed);
  const now = Date.now();
  const cached = trendingTailPoolCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.pool;
  }
  const inFlight = trendingTailPoolInFlight.get(cacheKey);
  if (inFlight) {
    if (cached) return cached.pool;
    const entry = await inFlight;
    if (entry.expiresAt > Date.now()) return entry.pool;
  }
  const stillCurrent = trendingTailPoolInvalidation.snapshot(userId);
  const task = (async (): Promise<TrendingTailCacheEntry> => {
    const pool = await buildTrendingTailPoolUncached(
      db,
      userId,
      region,
      excludeSubscribed,
    );
    return {
      expiresAt: Date.now() + TRENDING_TAIL_CACHE_TTL_MS,
      pool,
    };
  })();
  const settled = settlePoolBuild(
    task,
    cacheKey,
    trendingTailPoolCache,
    trendingTailPoolInFlight,
    stillCurrent,
  );
  // Stale-while-revalidate, same as the recommendation pool: an expired tail is
  // served instantly and the refresh lands in the background.
  if (cached) {
    settled.catch((error: unknown) => {
      logger.warn("feed.trending_tail_refresh_failed", {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return cached.pool;
  }
  return (await settled).pool;
}

/** Items already returned to the client (next slice starts here). */
export function resolveHomeFeedSkip(
  input: z.infer<typeof homeInputSchema> | undefined,
  pageSize: number,
): number {
  if (input?.cursor != null) return input.cursor;
  const page = input?.page ?? 1;
  return Math.max(0, (page - 1) * pageSize);
}

/** Personalized recommendations first, then trending-only rows (no duplicate videoIds). */
export function mergePersonalizedWithTrendingTail(
  personalized: UnifiedVideo[],
  tailPool: UnifiedVideo[],
): UnifiedVideo[] {
  const seen = new Set(personalized.map((v) => v.videoId));
  const out = [...personalized];
  for (const v of tailPool) {
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    out.push(v);
  }
  return out;
}

export function sliceHomeFeedStream(
  stream: UnifiedVideo[],
  skip: number,
  pageSize: number,
): { videos: UnifiedVideo[]; hasMore: boolean } {
  const videos = stream.slice(skip, skip + pageSize);
  const hasMore = skip + videos.length < stream.length;
  return { videos, hasMore };
}

type HomeFeedDb = Parameters<typeof getPersonalizedFeedVideos>[0];
type HomeStreamOpts = {
  pageSize: number;
  region: string;
};

/** The full merged home stream (personalized recs + optional trending tail). */
async function computeHomeStream(
  db: HomeFeedDb,
  userId: number,
  opts: HomeStreamOpts,
): Promise<{ stream: UnifiedVideo[]; coldStart: boolean }> {
  const settings = getUserSettings(db, userId);
  const [{ videos: personalized, coldStart }, tailPool] = await Promise.all([
    getPersonalizedFeedVideos(db, userId, opts),
    settings.personalizedFeedOnly
      ? Promise.resolve<UnifiedVideo[]>([])
      : buildTrendingTailPool(
          db,
          userId,
          opts.region,
          settings.excludeSubscribedFromRecommendations,
        ),
  ]);
  const stream = mergePersonalizedWithTrendingTail(personalized, tailPool);
  return { stream, coldStart };
}

function homeStreamCacheKey(
  userId: number,
  region: string,
  personalizedOnly: boolean,
): string {
  return `home-feed:v1:${userId}:${region}:${personalizedOnly ? 1 : 0}`;
}

const homeStreamSchema = z.array(unifiedVideoSchema);

function parseHomeStreamRow(
  row: { payloadJson: string } | null | undefined,
): UnifiedVideo[] | null {
  if (!row) return null;
  try {
    const parsed = homeStreamSchema.safeParse(JSON.parse(row.payloadJson));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const homeStreamRefreshInFlight = new Map<string, Promise<void>>();

/**
 * Applies the user's *current* exclusions to a materialized stream. The row
 * is never invalidated server-side (likes and watches clear the in-memory
 * pools constantly; recomputing on each would block most loads again), so a
 * channel blocked or a video disliked / marked "not interested" after the
 * row was written is dropped here instead. Cheap: one settings read plus one
 * indexed interactions lookup over the stream's ids.
 */
function withCurrentExclusions(
  db: HomeFeedDb,
  userId: number,
  settings: ReturnType<typeof getUserSettings>,
  stream: UnifiedVideo[],
): UnifiedVideo[] {
  const allowed = withoutBlockedChannels(stream, settings);
  if (allowed.length === 0) return allowed;
  const rejected = new Set(
    db
      .select({ videoId: interactions.videoId })
      .from(interactions)
      .where(
        and(
          eq(interactions.userId, userId),
          inArray(interactions.type, ["ignore", "dislike"]),
          inArray(
            interactions.videoId,
            allowed.map((v) => v.videoId),
          ),
        ),
      )
      .all()
      .map((r) => r.videoId),
  );
  return rejected.size === 0
    ? allowed
    : allowed.filter((v) => !rejected.has(v.videoId));
}

/**
 * Read-through cache for the merged home stream (per user, materialized in
 * SQLite). `cacheOnly` (the SSR prefetch) never computes — a cold miss returns
 * an empty stream so the client fetches it and shows its skeleton only then.
 *
 * An expired row still answers immediately while a recompute refreshes it in
 * the background: the row lives 10 min but the cache-warmer only rebuilds it
 * every 20, so blocking on the (upstream-heavy) recompute made roughly every
 * other home load wait. Only a user with no row at all waits.
 */
async function getHomeStream(
  db: HomeFeedDb,
  userId: number,
  opts: HomeStreamOpts & { cacheOnly?: boolean },
): Promise<{ stream: UnifiedVideo[]; coldStart: boolean }> {
  const settings = getUserSettings(db, userId);
  const key = homeStreamCacheKey(
    userId,
    opts.region,
    settings.personalizedFeedOnly,
  );
  const cachedStream = (row: { payloadJson: string } | null | undefined) => {
    const stream = parseHomeStreamRow(row);
    return stream && withCurrentExclusions(db, userId, settings, stream);
  };
  const fresh = cachedStream(readFreshCacheRow(db, key));
  if (fresh) return { stream: fresh, coldStart: false };
  const stale = cachedStream(readLatestCacheRow(db, key));
  if (opts.cacheOnly) {
    if (stale) return { stream: stale, coldStart: false };
    return { stream: [], coldStart: true };
  }
  if (stale) {
    if (!homeStreamRefreshInFlight.has(key)) {
      const refresh = computeHomeStream(db, userId, opts)
        .then(({ stream }) => {
          if (stream.length > 0) {
            writeCache(db, key, "owntube", stream, "home");
          }
        })
        .catch((error: unknown) => {
          logger.warn("feed.home_stream_refresh_failed", {
            userId,
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          homeStreamRefreshInFlight.delete(key);
        });
      homeStreamRefreshInFlight.set(key, refresh);
    }
    return { stream: stale, coldStart: false };
  }
  const { stream, coldStart } = await computeHomeStream(db, userId, opts);
  if (stream.length > 0) writeCache(db, key, "owntube", stream, "home");
  return { stream, coldStart };
}

/** Recompute + materialize a user's home stream (used by the cache warmer). */
export async function materializeHomeFeed(
  db: HomeFeedDb,
  userId: number,
  opts: HomeStreamOpts,
): Promise<void> {
  const settings = getUserSettings(db, userId);
  const { stream } = await computeHomeStream(db, userId, opts);
  if (stream.length > 0) {
    writeCache(
      db,
      homeStreamCacheKey(userId, opts.region, settings.personalizedFeedOnly),
      "owntube",
      stream,
      "home",
    );
  }
}

export const feedRouter = router({
  home: publicProcedure.input(homeInputSchema).query(async ({ ctx, input }) => {
    const pageSize = input?.pageSize ?? 24;
    const skip = resolveHomeFeedSkip(input, pageSize);
    const category = input?.category;
    const savedRegion =
      ctx.userId != null
        ? normalizeTrendingRegionStored(
            getUserSettings(ctx.db, ctx.userId).trendingRegion,
          )
        : undefined;
    const region = normalizeTrendingRegionStored(
      input?.region ?? savedRegion ?? "US",
    );
    try {
      if (ctx.userId && !category) {
        // Materialized read-through: SSR prefetch is cache-only (never blocks on
        // the reco engine / upstream); the client and warmer compute + persist.
        const { stream, coldStart } = await getHomeStream(ctx.db, ctx.userId, {
          pageSize,
          region,
          cacheOnly: ctx.prefetchCacheOnly ?? false,
        });
        const { videos, hasMore } = sliceHomeFeedStream(stream, skip, pageSize);
        return {
          kind: "personalized" as const,
          videos,
          coldStart,
          hasMore,
          region,
          category: null as null,
        };
      }
      const limit = Math.min(200, skip + pageSize + pageSize);
      const trending = await fetchTrendingVideos({
        region,
        limit,
        category,
      });
      let pool = trending.videos;
      if (ctx.userId) {
        const seenRows = ctx.db
          .select({ videoId: watchHistory.videoId })
          .from(watchHistory)
          .where(
            and(
              eq(watchHistory.userId, ctx.userId),
              eq(watchHistory.isDeleted, 0),
            ),
          )
          .limit(10_000)
          .all();
        const seen = new Set(seenRows.map((r) => r.videoId));
        pool = pool.filter((v) => !seen.has(v.videoId));
      }
      const { videos, hasMore } = sliceHomeFeedStream(pool, skip, pageSize);
      return {
        kind: "trending" as const,
        videos,
        coldStart: true,
        hasMore,
        region,
        category: category ?? null,
      };
    } catch (e) {
      if (e instanceof UpstreamUnavailableError) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
      }
      if (e instanceof RateLimitExceededError) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: e.message });
      }
      throw e;
    }
  }),
});
