import path from "node:path";
import cacache from "cacache";
import { logger } from "@/lib/logger";
import { registerInFlight } from "@/server/services/proxy/cache";

/**
 * Disk-backed cache for proxied binary assets (thumbnails, avatars, banners,
 * storyboard sprites) — the local-first read policy extended to images. The
 * browser cache only helps per device; this makes repeat asset loads local for
 * every client and removes the invidious→ytimg hop from warm pages.
 *
 * Storage is cacache (npm's content-addressed store): atomic writes, integrity
 * checking, and safe concurrent access come for free. Keys are the canonical
 * upstream path/URL; content-type and fetch time live in entry metadata.
 *
 * Read semantics match the JSON caches: fresh → serve; stale → serve and
 * revalidate in the background (single-flight); miss → fetch once. A fetcher
 * callback (not a URL) keeps upstream logic — e.g. the `vi/` thumbnail 404
 * fallback chain — with the caller. Media segments are intentionally NOT
 * cached here: huge, watched once, signed URLs rotate.
 */

export type AssetKind = "thumbnail" | "avatar" | "storyboard" | "image";

const TTL_SEC: Record<AssetKind, number> = {
  // maxres/hq stills can appear or improve shortly after upload.
  thumbnail: 24 * 60 * 60,
  avatar: 7 * 24 * 60 * 60,
  storyboard: 7 * 24 * 60 * 60,
  image: 24 * 60 * 60,
};

/** Refuse to cache anything larger (a mis-routed video would evict everything). */
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
/** Skip re-attempting cache fills for keys that recently proved uncacheable. */
const UNCACHEABLE_MEMO_MS = 10 * 60 * 1000;

function assetCacheDir(): string {
  const dataDir = process.env.DATABASE_PATH
    ? path.dirname(process.env.DATABASE_PATH)
    : path.join(process.cwd(), "data");
  return path.join(dataDir, "asset-cache");
}

export type CachedAsset = {
  body: Buffer;
  contentType: string;
};

type AssetMetadata = {
  contentType?: string;
  fetchedAt?: number;
  ttlSec?: number;
};

const inFlightAssets = new Map<string, Promise<CachedAsset | null>>();
const uncacheableUntil = new Map<string, number>();

export function clearAssetInFlight(): void {
  inFlightAssets.clear();
  uncacheableUntil.clear();
}

async function readEntry(
  key: string,
): Promise<{ asset: CachedAsset; fresh: boolean } | null> {
  try {
    const info = await cacache.get.info(assetCacheDir(), key);
    if (!info) return null;
    const meta = (info.metadata ?? {}) as AssetMetadata;
    if (!meta.contentType) return null;
    const { data } = await cacache.get(assetCacheDir(), key);
    const age = Date.now() / 1000 - (meta.fetchedAt ?? 0);
    return {
      asset: { body: data, contentType: meta.contentType },
      fresh: age < (meta.ttlSec ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch, validate, and store one asset. Returns null (and memoizes the key as
 * uncacheable for a while) when the response isn't a cacheable image, so the
 * caller can fall back to plain pass-through proxying. Upstream failures keep
 * any existing entry untouched.
 */
async function refreshAsset(
  key: string,
  kind: AssetKind,
  fetchUpstream: () => Promise<Response>,
): Promise<CachedAsset | null> {
  const r = await fetchUpstream().catch(() => null);
  if (!r || !r.ok || !r.body) {
    await r?.body?.cancel().catch(() => {});
    return null;
  }
  const contentType = r.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    await r.body.cancel().catch(() => {});
    uncacheableUntil.set(key, Date.now() + UNCACHEABLE_MEMO_MS);
    return null;
  }
  const body = Buffer.from(await r.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_ASSET_BYTES) {
    uncacheableUntil.set(key, Date.now() + UNCACHEABLE_MEMO_MS);
    return null;
  }
  await cacache.put(assetCacheDir(), key, body, {
    metadata: {
      contentType,
      fetchedAt: Math.floor(Date.now() / 1000),
      ttlSec: TTL_SEC[kind],
    } satisfies AssetMetadata,
  });
  return { body, contentType };
}

/**
 * Serve an asset from the disk cache, revalidating stale entries in the
 * background. Returns null when the asset can't be cached (non-image, too
 * large, upstream error with no prior entry) — callers should then fall back
 * to their normal pass-through path.
 */
export async function getCachedAsset(
  key: string,
  kind: AssetKind,
  fetchUpstream: () => Promise<Response>,
): Promise<CachedAsset | null> {
  const memo = uncacheableUntil.get(key);
  if (memo) {
    if (Date.now() < memo) return null;
    uncacheableUntil.delete(key);
  }

  const entry = await readEntry(key);
  if (entry?.fresh) return entry.asset;

  const inFlight = inFlightAssets.get(key);
  const task = inFlight ?? refreshAsset(key, kind, fetchUpstream);
  if (!inFlight) registerInFlight(inFlightAssets, key, task);

  if (entry) return entry.asset; // stale: serve now, task refreshes in background
  const refreshed = await task;
  return refreshed;
}

/**
 * Bound the store: drop least-recently-written entries beyond `maxBytes`, then
 * garbage-collect unreferenced content. Run from the cache warmer.
 */
export async function pruneAssetCache(
  maxBytes: number,
): Promise<{ removed: number; totalBytes: number }> {
  const dir = assetCacheDir();
  let entries: Awaited<ReturnType<typeof cacache.ls>>;
  try {
    entries = await cacache.ls(dir);
  } catch {
    return { removed: 0, totalBytes: 0 };
  }
  const list = Object.values(entries).sort((a, b) => b.time - a.time); // newest first
  let total = 0;
  let removed = 0;
  for (const entry of list) {
    total += entry.size;
    if (total > maxBytes) {
      await cacache.rm.entry(dir, entry.key).catch(() => {});
      removed++;
    }
  }
  if (removed > 0) {
    await cacache.verify(dir).catch(() => {});
    logger.info("asset_cache.pruned", { removed, totalBytes: total });
  }
  return { removed, totalBytes: total };
}
