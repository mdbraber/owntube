import { timingSafeEqual } from "node:crypto";
import { channelTabSchema, continuationSchema } from "@owntube/contracts/model";
import type { Catalog } from "@owntube/youtube/catalog";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { TtlCache } from "./cache.ts";
import type { CacheStore } from "./store.ts";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long answers stay fresh, and how long a stale one may stand in when YouTube fails. */
const POLICY = {
  video: { ttl: 30 * MINUTE, stale: 24 * HOUR },
  channel: { ttl: 30 * MINUTE, stale: 24 * HOUR },
  search: { ttl: 6 * HOUR, stale: 24 * HOUR },
  suggestions: { ttl: 24 * HOUR, stale: 7 * 24 * HOUR },
  comments: { ttl: 30 * MINUTE, stale: 24 * HOUR },
  playlist: { ttl: 30 * MINUTE, stale: 24 * HOUR },
  live: { ttl: 5 * MINUTE, stale: HOUR },
  resolve: { ttl: 7 * 24 * HOUR, stale: 30 * 24 * HOUR },
} as const;

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

  const cached = <T>(
    kind: keyof typeof POLICY,
    key: string,
    load: () => Promise<T>,
  ) => cache.get(`${kind}:${key}`, POLICY[kind].ttl, POLICY[kind].stale, load);

  const answer = async (c: Context, work: () => Promise<unknown>) => {
    try {
      return c.json(await work());
    } catch (error) {
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
    return answer(c, () => cached("video", id, () => catalog.video(id)));
  });

  app.get("/api/video/:id/comments", (c) => {
    const id = c.req.param("id");
    const sort = c.req.query("sort") === "new" ? "new" : "top";
    if (!VIDEO_ID.test(id)) return c.json({ error: "bad video id" }, 400);
    const next = continuation(c);
    return answer(c, () =>
      cached("comments", `${id}:${sort}:${next ?? ""}`, () =>
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
      cached("channel", `${id}:${tab.data}:${next ?? ""}`, () =>
        catalog.channel(id, tab.data, next),
      ),
    );
  });

  app.get("/api/search", (c) => {
    const q = z.string().trim().min(1).max(200).safeParse(c.req.query("q"));
    if (!q.success) return c.json({ error: "bad query" }, 400);
    const next = continuation(c);
    return answer(c, () =>
      cached("search", `${q.data}:${next ?? ""}`, () =>
        catalog.search(q.data, next),
      ),
    );
  });

  app.get("/api/suggestions", (c) => {
    const q = z.string().trim().min(1).max(200).safeParse(c.req.query("q"));
    if (!q.success) return c.json({ error: "bad query" }, 400);
    return answer(c, () =>
      cached("suggestions", q.data, () => catalog.suggestions(q.data)),
    );
  });

  app.get("/api/playlist/:id", (c) => {
    const id = c.req.param("id");
    if (!PLAYLIST_ID.test(id)) return c.json({ error: "bad playlist id" }, 400);
    const next = continuation(c);
    return answer(c, () =>
      cached("playlist", `${id}:${next ?? ""}`, () =>
        catalog.playlist(id, next),
      ),
    );
  });

  app.get("/api/live", (c) =>
    answer(c, () => cached("live", "", () => catalog.live())),
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
      cached("resolve", target.data, async () => ({
        channelId: (await catalog.resolveChannel(target.data)) ?? null,
      })),
    );
  });

  return app;
}
