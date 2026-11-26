import { timingSafeEqual } from "node:crypto";
import {
  channelTabSchema,
  continuationSchema,
  uploadDateSchema,
  type VideoDetail,
  type VideoSummary,
  videoSummarySchema,
} from "@owntube/contracts/model";
import type { Catalog } from "@owntube/youtube/catalog";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type CacheMode, NotCached, TtlCache } from "./cache.ts";
import type { CacheStore } from "./store.ts";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const BATCH_MAX = 100;
const BATCH_CONCURRENCY = 4;

/** A video page's list-row fields. */
function summaryOf(d: VideoDetail): VideoSummary {
  return videoSummarySchema.parse(d);
}

/** `work` over `items`, at most `limit` at a time, results in order. */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, lane),
  );
  return out;
}

/** How long answers stay fresh, and how long a stale one may stand in when YouTube fails. */
const POLICY = {
  // A live or upcoming video changes state (goes live, ends), so it is asked again soon.
  video: {
    ttl: (v: VideoDetail) => (v.live === "none" ? 30 * MINUTE : MINUTE),
    stale: 24 * HOUR,
  },
  channel: { ttl: 30 * MINUTE, stale: 24 * HOUR },
  search: { ttl: 6 * HOUR, stale: 24 * HOUR },
  suggestions: { ttl: 24 * HOUR, stale: 7 * 24 * HOUR },
  comments: { ttl: 30 * MINUTE, stale: 24 * HOUR },
  playlist: { ttl: 30 * MINUTE, stale: 24 * HOUR },
  live: { ttl: 5 * MINUTE, stale: HOUR },
  resolve: { ttl: 7 * 24 * HOUR, stale: 30 * 24 * HOUR },
};

/**
 * The catalogue API the web app reads (`/api/*`, JSON in the shape of
 * `@owntube/contracts`). Not public: requests carry the shared key as a
 * bearer token, and only `/media/*` is routed to the gateway from outside.
 */
export function apiRoutes(
  catalog: Catalog,
  apiKey: string,
  store?: CacheStore,
): Hono {
  const app = new Hono();
  const cache = new TtlCache(store ? { store } : {});
  const expected = Buffer.from(`Bearer ${apiKey}`);

  app.use("/api/*", async (c, next) => {
    const given = Buffer.from(c.req.header("authorization") ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  // `?cache=only` answers from the cache or not at all; `?cache=refresh` asks YouTube again.
  const cached = <T>(
    c: Context,
    kind: keyof typeof POLICY,
    key: string,
    load: () => Promise<T>,
  ) => {
    const asked = c.req.query("cache");
    const mode: CacheMode =
      asked === "only" || asked === "refresh" ? asked : "normal";
    // Each kind's loader answers the type its policy reads.
    const policy = POLICY[kind] as {
      ttl: number | ((v: T) => number);
      stale: number;
    };
    return cache.get(`${kind}:${key}`, policy.ttl, policy.stale, load, mode);
  };

  const answer = async (c: Context, work: () => Promise<unknown>) => {
    try {
      return c.json(await work());
    } catch (error) {
      if (error instanceof NotCached)
        return c.json({ error: "not cached" }, 404);
      return c.json(
        {
          error: "upstream",
          reason: error instanceof Error ? error.message : String(error),
        },
        502,
      );
    }
  };

  const continuation = (c: Context) => {
    const parsed = continuationSchema
      .optional()
      .safeParse(c.req.query("continuation") || undefined);
    return parsed.success ? parsed.data : undefined;
  };

  app.get("/api/video/:id", (c) => {
    const id = c.req.param("id");
    if (!VIDEO_ID.test(id)) return c.json({ error: "bad video id" }, 400);
    return answer(c, () => cached(c, "video", id, () => catalog.video(id)));
  });

  // Summaries for a list of ids (queue, history, saved, playlists), out of the
  // same per-video cache as the video page. Ids YouTube will not describe are
  // left out; the caller keeps what it stored.
  app.get("/api/videos", async (c) => {
    const ids = [
      ...new Set((c.req.query("ids") ?? "").split(",").filter(Boolean)),
    ];
    if (
      ids.length === 0 ||
      ids.length > BATCH_MAX ||
      !ids.every((id) => VIDEO_ID.test(id))
    )
      return c.json({ error: `1 to ${BATCH_MAX} video ids` }, 400);
    const videos = await mapLimited(ids, BATCH_CONCURRENCY, (id) =>
      cached(c, "video", id, () => catalog.video(id)).then(
        (detail) => summaryOf(detail),
        () => undefined,
      ),
    );
    return c.json({ videos: videos.filter((v) => v !== undefined) });
  });

  app.get("/api/video/:id/comments", (c) => {
    const id = c.req.param("id");
    const sort = c.req.query("sort") === "new" ? "new" : "top";
    if (!VIDEO_ID.test(id)) return c.json({ error: "bad video id" }, 400);
    const next = continuation(c);
    return answer(c, () =>
      cached(c, "comments", `${id}:${sort}:${next ?? ""}`, () =>
        catalog.comments(id, sort, next),
      ),
    );
  });

  app.get("/api/channel/:id", (c) => {
    const id = c.req.param("id");
    const tab = channelTabSchema.safeParse(c.req.query("tab") ?? "videos");
    if (!CHANNEL_ID.test(id) || !tab.success)
      return c.json({ error: "bad channel id or tab" }, 400);
    const next = continuation(c);
    return answer(c, () =>
      cached(c, "channel", `${id}:${tab.data}:${next ?? ""}`, () =>
        catalog.channel(id, tab.data, next),
      ),
    );
  });

  app.get("/api/search", (c) => {
    const q = z.string().trim().min(1).max(200).safeParse(c.req.query("q"));
    const date = uploadDateSchema.optional().safeParse(c.req.query("date"));
    if (!q.success || !date.success)
      return c.json({ error: "bad query or date" }, 400);
    const next = continuation(c);
    const uploadDate = date.data;
    return answer(c, () =>
      cached(c, "search", `${q.data}:${uploadDate ?? ""}:${next ?? ""}`, () =>
        catalog.search(q.data, {
          ...(uploadDate ? { uploadDate } : {}),
          ...(next ? { continuation: next } : {}),
        }),
      ),
    );
  });

  app.get("/api/suggestions", (c) => {
    const q = z.string().trim().min(1).max(200).safeParse(c.req.query("q"));
    if (!q.success) return c.json({ error: "bad query" }, 400);
    return answer(c, () =>
      cached(c, "suggestions", q.data, () => catalog.suggestions(q.data)),
    );
  });

  app.get("/api/playlist/:id", (c) => {
    const id = c.req.param("id");
    if (!PLAYLIST_ID.test(id)) return c.json({ error: "bad playlist id" }, 400);
    const next = continuation(c);
    return answer(c, () =>
      cached(c, "playlist", `${id}:${next ?? ""}`, () =>
        catalog.playlist(id, next),
      ),
    );
  });

  app.get("/api/live", (c) =>
    answer(c, () => cached(c, "live", "", () => catalog.live())),
  );

  app.get("/api/resolve", (c) => {
    const target = z
      .string()
      .trim()
      .min(2)
      .max(300)
      .safeParse(c.req.query("url"));
    if (!target.success) return c.json({ error: "bad url" }, 400);
    return answer(c, () =>
      cached(c, "resolve", target.data, async () => ({
        channelId: (await catalog.resolveChannel(target.data)) ?? null,
      })),
    );
  });

  return app;
}
