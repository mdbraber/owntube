import { createHash } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { logger } from "@/lib/logger";
import type { AppDb } from "@/server/db/client";
import { videoCache } from "@/server/db/schema";
import type {
  ChannelPageInput,
  SearchVideosInput,
  ShortsFeedInput,
  TrendingInput,
  VideoDetailInput,
} from "@/server/services/proxy.types";

const CACHE_TTL_SEC = 6 * 60 * 60;
/** Channel “videos” lists change often; long TTL hid fresh uploads from recommendations. */
const CHANNEL_PAGE_CACHE_TTL_SEC = 45 * 60;
/** Home Shorts shelf discovery — fresher than the default 6h shorts cache. */
const SHORTS_SHELF_CACHE_TTL_SEC = 30 * 60;
/** Invidious/Piped HLS and DASH URLs expire quickly; long TTL serves dead 404 manifests. */
const STREAMS_DETAIL_CACHE_TTL_SEC = 3 * 60;
/** Channel RSS + long-form uploads windows; the cache warmer refreshes every cycle. */
const RSS_CACHE_TTL_SEC = 15 * 60;
/** First page of a video's comments; warmed for likely-next videos. */
const COMMENTS_CACHE_TTL_SEC = 30 * 60;
/**
 * Streams payloads carry signed googlevideo URLs with an `expire=<unix>` param
 * (~6h out). Cache them as long as those URLs stay valid, minus a safety
 * margin — a warmed video then plays instantly for hours instead of 3 minutes.
 */
const STREAMS_DETAIL_CACHE_TTL_MAX_SEC = 3 * 60 * 60;
const STREAMS_EXPIRE_SAFETY_SEC = 15 * 60;

export type CacheKind =
  | "search"
  | "streams"
  | "related"
  | "trending"
  | "shorts"
  | "channel"
  | "rss"
  | "comments"
  | "sponsorblock";

export type CacheSource = "piped" | "invidious" | "youtube" | "sponsorblock";

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function searchCacheKey(input: SearchVideosInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 3,
        kind: "search",
        q: input.q,
        limit: input.limit ?? 20,
        c: input.continuation ?? null,
      }),
    )
    .digest("hex");
  return `search:v3:${h}`;
}

export function detailCacheKey(input: VideoDetailInput): string {
  const h = createHash("sha256")
    .update(JSON.stringify({ v: 4, kind: "streams", videoId: input.videoId }))
    .digest("hex");
  return `streams:v4:${h}`;
}

export function relatedCacheKey(input: VideoDetailInput): string {
  const h = createHash("sha256")
    .update(JSON.stringify({ v: 4, kind: "related", videoId: input.videoId }))
    .digest("hex");
  return `related:v4:${h}`;
}

export function shortsFeedCacheKey(input: ShortsFeedInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 2,
        kind: "shorts",
        region: input.region,
        limit: input.limit ?? 20,
        purpose: input.purpose ?? "feed",
        c: input.continuation ?? null,
        dq: input.discoveryQueries ?? null,
      }),
    )
    .digest("hex");
  return `shorts:v2:${h}`;
}

export function trendingCacheKey(input: TrendingInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 3,
        kind: "trending",
        region: input.region.toUpperCase(),
        limit: input.limit ?? 40,
        category: input.category ?? null,
      }),
    )
    .digest("hex");
  return `trending:v3:${h}`;
}

export function channelCacheKey(input: ChannelPageInput): string {
  const h = createHash("sha256")
    .update(
      JSON.stringify({
        v: 4,
        kind: "channel",
        channelId: input.channelId,
        tab: input.tab ?? "videos",
        c: input.continuation ?? null,
      }),
    )
    .digest("hex");
  return `channel:v4:${h}`;
}

export function readFreshCacheRow(db: AppDb, key: string) {
  return db
    .select()
    .from(videoCache)
    .where(
      and(eq(videoCache.cacheKey, key), gt(videoCache.expiresAt, nowUnix())),
    )
    .limit(1)
    .all()[0];
}

export function readLatestCacheRow(db: AppDb, key: string) {
  return db
    .select()
    .from(videoCache)
    .where(eq(videoCache.cacheKey, key))
    .orderBy(desc(videoCache.fetchedAt))
    .limit(1)
    .all()[0];
}

function cacheTtlSecForKind(
  kind: CacheKind,
  options?: { shortsPurpose?: "feed" | "shelf" },
): number {
  if (kind === "streams") return STREAMS_DETAIL_CACHE_TTL_SEC;
  if (kind === "channel") return CHANNEL_PAGE_CACHE_TTL_SEC;
  if (kind === "rss") return RSS_CACHE_TTL_SEC;
  if (kind === "comments") return COMMENTS_CACHE_TTL_SEC;
  if (kind === "shorts" && options?.shortsPurpose === "shelf") {
    return SHORTS_SHELF_CACHE_TTL_SEC;
  }
  return CACHE_TTL_SEC;
}

/** Persists a live upstream response. `payload` is JSON-serialized as stored (never a stale `sourceUsed: "cache"` row). */
export function writeCache(
  db: AppDb,
  key: string,
  source: CacheSource,
  payload: unknown,
  kind: CacheKind,
  options?: { shortsPurpose?: "feed" | "shelf" },
): void {
  const t = nowUnix();
  const ttl =
    kind === "streams"
      ? streamsTtlSec(JSON.stringify(payload), t)
      : cacheTtlSecForKind(kind, options);
  const row = {
    cacheKey: key,
    source,
    kind,
    payloadJson: JSON.stringify(payload),
    fetchedAt: t,
    expiresAt: t + ttl,
  };
  db.insert(videoCache)
    .values(row)
    .onConflictDoUpdate({
      target: videoCache.cacheKey,
      set: {
        payloadJson: row.payloadJson,
        source: row.source,
        kind: row.kind,
        fetchedAt: row.fetchedAt,
        expiresAt: row.expiresAt,
      },
    })
    .run();
  logger.info("video_cache.write", {
    cacheKey: key,
    kind,
    source,
    ttlSec: ttl,
  });
}

/**
 * TTL for a streams payload: bounded by the earliest `expire=` timestamp in
 * its stream URLs (minus a safety margin), capped at
 * STREAMS_DETAIL_CACHE_TTL_MAX_SEC. Falls back to the short legacy TTL when no
 * expire param is present (e.g. HLS-only or unexpected upstream shapes).
 */
function streamsTtlSec(payloadJson: string, now: number): number {
  let minExpire: number | null = null;
  for (const m of payloadJson.matchAll(/[?&]expire=(\d{9,11})/g)) {
    const v = Number(m[1]);
    if (Number.isSafeInteger(v) && v > now) {
      if (minExpire === null || v < minExpire) minExpire = v;
    }
  }
  if (minExpire === null) return STREAMS_DETAIL_CACHE_TTL_SEC;
  const untilExpire = minExpire - now - STREAMS_EXPIRE_SAFETY_SEC;
  return Math.max(
    STREAMS_DETAIL_CACHE_TTL_SEC,
    Math.min(STREAMS_DETAIL_CACHE_TTL_MAX_SEC, untilExpire),
  );
}

/**
 * Register `task` as the in-flight fetch for `key` and detach its lifecycle
 * from the caller: the map entry is removed when the task settles, and a
 * rejection is marked handled so a caller that served stale data and never
 * awaits the refresh cannot leak an unhandled rejection.
 *
 * This is the glue for serve-stale-and-revalidate reads: interactive requests
 * return the latest cached row immediately while the registered task refreshes
 * the cache in the background; concurrent callers of the same key share one
 * upstream fetch instead of stampeding.
 */
export function registerInFlight<T>(
  map: Map<string, Promise<T>>,
  key: string,
  task: Promise<T>,
): void {
  map.set(key, task);
  const cleanup = () => map.delete(key);
  task.then(cleanup, cleanup);
}
