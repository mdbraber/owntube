import { Hono } from "hono";
import { mediaRoutes } from "./media/routes.ts";
import type { PlaybackSessions } from "./media/sessions.ts";

export interface AppDeps {
  sessions: PlaybackSessions;
  signingKey: string;
}

/** Builds the HTTP app. Kept free of listening/process concerns so tests can call it directly. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/", mediaRoutes(deps.sessions, deps.signingKey));
  return app;
}
