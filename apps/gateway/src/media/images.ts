import cacache from "cacache";
import { Hono } from "hono";

/**
 * YouTube's images (thumbnails, storyboards, avatars, banners) through the
 * gateway, cached on disk: clients never contact Google, and a repeat load is
 * local. Only these hosts can be reached through it.
 */
const ORIGINS: Record<
  string,
  { origin: string; ttlSec: number; keepQuery: boolean }
> = {
  vi: {
    origin: "https://i.ytimg.com/vi/",
    ttlSec: 24 * 3600,
    keepQuery: false,
  },
  vi_webp: {
    origin: "https://i.ytimg.com/vi_webp/",
    ttlSec: 24 * 3600,
    keepQuery: false,
  },
  // Storyboard sprites are signed with a query (`sigh=`).
  sb: {
    origin: "https://i.ytimg.com/sb/",
    ttlSec: 7 * 24 * 3600,
    keepQuery: true,
  },
  yt3: {
    origin: "https://yt3.ggpht.com/",
    ttlSec: 7 * 24 * 3600,
    keepQuery: false,
  },
  yt3gu: {
    origin: "https://yt3.googleusercontent.com/",
    ttlSec: 7 * 24 * 3600,
    keepQuery: false,
  },
};

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
  app.get("/media/img/:kind/*", async (c) => {
    const spec = ORIGINS[c.req.param("kind")];
    const rest = c.req.path.slice(`/media/img/${c.req.param("kind")}/`.length);
    if (!spec || rest === "" || rest.includes(".."))
      return c.text("not found", 404);
    const query = spec.keepQuery ? new URL(c.req.url).search : "";
    const url = `${spec.origin}${rest}${query}`;
    const headers = (type: string) => ({
      "content-type": type,
      "cache-control": `public, max-age=${spec.ttlSec}`,
    });

    const cached = await cacache.get(options.cacheDir, url).catch(() => null);
    if (cached) {
      const meta = cached.metadata as Entry;
      // Stale: serve it now and refresh in the background.
      if (now() - meta.fetchedAt > spec.ttlSec * 1000)
        void fill(url).catch(() => {});
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
