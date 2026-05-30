import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { stripRestrictedListVideos } from "@/lib/feed-exclude-restricted";
import { watchHistory } from "@/server/db/schema";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { getPersonalizedFeedVideos } from "@/server/recommendation/engine";
import { fetchTrendingVideos } from "@/server/services/proxy";
import {
  trendingVideoCategorySchema,
  type UnifiedVideo,
} from "@/server/services/proxy.types";
import {
  getUserProxyOverrides,
  getUserSettings,
  normalizeTrendingRegionStored,
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

type TrendingTailCacheEntry = {
  expiresAt: number;
  pool: UnifiedVideo[];
};

const TRENDING_TAIL_CACHE_TTL_MS = 90_000;
const trendingTailPoolCache = new Map<string, TrendingTailCacheEntry>();
const trendingTailPoolInFlight = new Map<
  string,
  Promise<TrendingTailCacheEntry>
>();

function trendingTailCacheKey(
  userId: number | null,
  region: string,
  hideRestricted: boolean,
  overrides: ReturnType<typeof getUserProxyOverrides>,
): string {
  const piped = overrides?.pipedBaseUrl?.trim() ?? "";
  const invidious = overrides?.invidiousBaseUrl?.trim() ?? "";
  return `tail|${userId ?? "anon"}|${region}|${hideRestricted ? 1 : 0}|${piped}|${invidious}`;
}

async function buildTrendingTailPoolUncached(
  db: Parameters<typeof fetchTrendingVideos>[0],
  userId: number | null,
  region: string,
  overrides: ReturnType<typeof getUserProxyOverrides>,
  hideRestricted: boolean,
) {
  const trending = await fetchTrendingVideos(
    db,
    { region, limit: 200 },
    overrides,
  );
  let pool = hideRestricted
    ? stripRestrictedListVideos(trending.videos)
    : trending.videos;
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
  }
  return pool;
}

async function buildTrendingTailPool(
  db: Parameters<typeof fetchTrendingVideos>[0],
  userId: number | null,
  region: string,
  overrides: ReturnType<typeof getUserProxyOverrides>,
  hideRestricted: boolean,
) {
  const cacheKey = trendingTailCacheKey(
    userId,
    region,
    hideRestricted,
    overrides,
  );
  const now = Date.now();
  const cached = trendingTailPoolCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.pool;
  }
  const inFlight = trendingTailPoolInFlight.get(cacheKey);
  if (inFlight) {
    const entry = await inFlight;
    if (entry.expiresAt > Date.now()) return entry.pool;
  }
  const task = (async (): Promise<TrendingTailCacheEntry> => {
    const pool = await buildTrendingTailPoolUncached(
      db,
      userId,
      region,
      overrides,
      hideRestricted,
    );
    return {
      expiresAt: Date.now() + TRENDING_TAIL_CACHE_TTL_MS,
      pool,
    };
  })();
  trendingTailPoolInFlight.set(cacheKey, task);
  try {
    const entry = await task;
    trendingTailPoolCache.set(cacheKey, entry);
    return entry.pool;
  } finally {
    trendingTailPoolInFlight.delete(cacheKey);
  }
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
    const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
    try {
      if (ctx.userId && !category) {
        const settings = getUserSettings(ctx.db, ctx.userId);
        const { videos: personalized, coldStart } =
          await getPersonalizedFeedVideos(ctx.db, ctx.userId, {
            pageSize,
            region,
            overrides,
          });
        const tailPool = await buildTrendingTailPool(
          ctx.db,
          ctx.userId,
          region,
          overrides,
          settings.hideRestrictedVideos,
        );
        const stream = mergePersonalizedWithTrendingTail(
          settings.hideRestrictedVideos
            ? stripRestrictedListVideos(personalized)
            : personalized,
          tailPool,
        );
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
      const trending = await fetchTrendingVideos(
        ctx.db,
        { region, limit, category },
        overrides,
      );
      let pool = stripRestrictedListVideos(trending.videos);
      if (ctx.userId) {
        const settings = getUserSettings(ctx.db, ctx.userId);
        if (!settings.hideRestrictedVideos) {
          pool = trending.videos;
        }
      }
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
