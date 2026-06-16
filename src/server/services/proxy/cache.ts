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
const CHANNEL_PAGE_CACHE_TTL_SEC = 10 * 60;
/** Home Shorts shelf discovery — fresher than the default 6h shorts cache. */
const SHORTS_SHELF_CACHE_TTL_SEC = 10 * 60;
/** Invidious/Piped HLS and DASH URLs expire quickly; long TTL serves dead 404 manifests. */
const STREAMS_DETAIL_CACHE_TTL_SEC = 3 * 60;

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
  kind: "search" | "streams" | "related" | "trending" | "shorts" | "channel",
  options?: { shortsPurpose?: "feed" | "shelf" },
): number {
  if (kind === "streams") return STREAMS_DETAIL_CACHE_TTL_SEC;
  if (kind === "channel") return CHANNEL_PAGE_CACHE_TTL_SEC;
  if (kind === "shorts" && options?.shortsPurpose === "shelf") {
    return SHORTS_SHELF_CACHE_TTL_SEC;
  }
  return CACHE_TTL_SEC;
}

/** Persists a live upstream response. `payload` is JSON-serialized as stored (never a stale `sourceUsed: "cache"` row). */
export function writeCache(
  db: AppDb,
  key: string,
  source: "piped" | "invidious",
  payload: unknown,
  kind: "search" | "streams" | "related" | "trending" | "shorts" | "channel",
  options?: { shortsPurpose?: "feed" | "shelf" },
): void {
  const t = nowUnix();
  const ttl = cacheTtlSecForKind(kind, options);
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
