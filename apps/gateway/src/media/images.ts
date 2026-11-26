import cacache from "cacache";
import { Hono } from "hono";

/**
 * YouTube's images (thumbnails, storyboards, avatars, banners) through the
 * gateway, cached on disk: clients never contact Google, and a repeat load is
 * local. Only these hosts can be reached through it.
 */
const ORIGINS: Record<string, string> = {
  yti: "https://i.ytimg.com/",
  yti9: "https://i9.ytimg.com/",
  yt3: "https://yt3.ggpht.com/",
  yt3gu: "https://yt3.googleusercontent.com/",
};

/** Thumbnails can improve after upload; avatars, banners and storyboard sprites rarely change. */
function ttlSec(key: string, path: string): number {
  return key.startsWith("yti") && !path.startsWith("sb/")
    ? 24 * 3600
    : 7 * 24 * 3600;
}

/** Larger than this is not an image we cache (a mis-routed video would evict everything). */
const MAX_BYTES = 8 * 1024 * 1024;

interface Entry {
  type: string;
  fetchedAt: number;
}

export interface ImageOptions {
  cacheDir: string;
  fetch: typeof globalThis.fetch;
  /** Cache size kept by `prune` (default 1 GiB). */
  maxBytes?: number;
  now?: () => number;
}

export function imageRoutes(options: ImageOptions): Hono {
  const now = options.now ?? Date.now;
  const inFlight = new Map<
    string,
    Promise<{ body: Buffer; type: string } | null>
  >();

  /** Fetches into the cache; concurrent requests for one URL share one upstream fetch. */
  function fill(url: string): Promise<{ body: Buffer; type: string } | null> {
    let pending = inFlight.get(url);
    if (!pending) {
      pending = (async () => {
        const res = await options.fetch(url, {
          headers: { accept: "image/avif,image/webp,image/*" },
        });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.startsWith("image/")) {
          await res.body?.cancel();
          return null;
        }
        const body = Buffer.from(await res.arrayBuffer());
        if (body.byteLength > MAX_BYTES) return null;
        const metadata: Entry = { type, fetchedAt: now() };
        await cacache.put(options.cacheDir, url, body, { metadata });
        return { body, type };
      })().finally(() => inFlight.delete(url));
      inFlight.set(url, pending);
    }
    return pending;
  }

  const app = new Hono();
  app.get("/media/img/:host/*", async (c) => {
    const key = c.req.param("host");
    const origin = ORIGINS[key];
    const rest = c.req.path.slice(`/media/img/${key}/`.length);
    if (!origin || rest === "" || rest.includes(".."))
      return c.text("not found", 404);
    // Queries are kept: YouTube signs thumbnail and storyboard URLs.
    const url = `${origin}${rest}${new URL(c.req.url).search}`;
    const ttl = ttlSec(key, rest);
    const headers = (type: string) => ({
      "content-type": type,
      "cache-control": `public, max-age=${ttl}`,
    });

    const cached = await cacache.get(options.cacheDir, url).catch(() => null);
    if (cached) {
      const meta = cached.metadata as Entry;
      // Stale: serve it now and refresh in the background.
      if (now() - meta.fetchedAt > ttl * 1000) void fill(url).catch(() => {});
      return c.body(new Uint8Array(cached.data), 200, headers(meta.type));
    }
    const fresh = await fill(url).catch(() => null);
    if (!fresh) return c.text("image unavailable", 404);
    return c.body(new Uint8Array(fresh.body), 200, headers(fresh.type));
  });
  return app;
}

/** Removes the least recently fetched images until the cache is under `maxBytes`. */
export async function pruneImages(
  cacheDir: string,
  maxBytes = 1024 * 1024 * 1024,
): Promise<number> {
  const entries = Object.values(await cacache.ls(cacheDir));
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  let removed = 0;
  for (const entry of entries.sort((a, b) => a.time - b.time)) {
    if (total <= maxBytes) break;
    await cacache.rm.entry(cacheDir, entry.key);
    total -= entry.size;
    removed++;
  }
  // Removing index entries leaves their content; verify collects it.
  await cacache.verify(cacheDir);
  return removed;
}
