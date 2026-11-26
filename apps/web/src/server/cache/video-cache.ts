/**
 * The web app's own cached data in `video_cache`: channel RSS windows,
 * SponsorBlock segments and the materialized home feed. YouTube's catalogue
 * is cached by the gateway, not here.
 */
import { and, desc, eq, gt } from "drizzle-orm";
import { logger } from "@/lib/logger";
import type { AppDb } from "@/server/db/client";
import { videoCache } from "@/server/db/schema";

/** Channel RSS + long-form uploads windows; refreshed every warm cycle. */
const RSS_CACHE_TTL_SEC = 15 * 60;
/** Materialized personalized home feed, per user. */
const HOME_FEED_CACHE_TTL_SEC = 10 * 60;
const DEFAULT_TTL_SEC = 6 * 60 * 60;

export type CacheKind = "rss" | "sponsorblock" | "home";

export type CacheSource = "youtube" | "sponsorblock" | "owntube";

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
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

/**
 * Oldest expired row a serve-stale-and-revalidate read answers with
 * instantly; past it a read waits for the recomputation.
 */
export const INSTANT_STALE_MAX_AGE_SEC = 6 * 60 * 60;

/** Latest row for `key` if fetched within {@link INSTANT_STALE_MAX_AGE_SEC}. */
export function readRecentCacheRow(db: AppDb, key: string) {
  const row = readLatestCacheRow(db, key);
  if (!row || row.fetchedAt < nowUnix() - INSTANT_STALE_MAX_AGE_SEC) {
    return undefined;
  }
  return row;
}

function cacheTtlSecForKind(kind: CacheKind): number {
  if (kind === "rss") return RSS_CACHE_TTL_SEC;
  if (kind === "home") return HOME_FEED_CACHE_TTL_SEC;
  return DEFAULT_TTL_SEC;
}

/** Stores `payload` (JSON) under `key` for its kind's TTL, or `ttlSec`. */
export function writeCache(
  db: AppDb,
  key: string,
  source: CacheSource,
  payload: unknown,
  kind: CacheKind,
  options?: { ttlSec?: number },
): void {
  const t = nowUnix();
  const ttl = options?.ttlSec ?? cacheTtlSecForKind(kind);
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
