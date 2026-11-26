import type { Catalog } from "@owntube/youtube/catalog";
import { Hono } from "hono";
import { apiRoutes } from "./api/routes.ts";
import type { CacheStore } from "./api/store.ts";
import { imageRoutes } from "./media/images.ts";
import { mediaRoutes } from "./media/routes.ts";
import type { PlaybackSessions } from "./media/sessions.ts";

export interface AppDeps {
  sessions: PlaybackSessions;
  catalog: Catalog;
  /** Keeps catalogue answers across restarts. */
  metadataStore?: CacheStore;
  signingKey: string;
  images: { cacheDir: string; fetch: typeof globalThis.fetch };
}

/** Builds the HTTP app. Kept free of listening/process concerns so tests can call it directly. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/", mediaRoutes(deps.sessions, deps.signingKey));
  app.route("/", imageRoutes(deps.images));
  // The web app's catalogue API, authenticated with the same shared key.
  app.route("/", apiRoutes(deps.catalog, deps.signingKey, deps.metadataStore));
  return app;
}
