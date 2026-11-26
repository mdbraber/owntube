import { Hono } from "hono";

/** Builds the HTTP app. Kept free of listening/process concerns so tests can call it directly. */
export function createApp(): Hono {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));
  return app;
}
