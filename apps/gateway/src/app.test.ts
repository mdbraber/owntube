import { SessionPool } from "@owntube/youtube/session";
import { YouTube } from "@owntube/youtube/youtube";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { PlaybackSessions } from "./media/sessions.ts";
import { signPlayback } from "./media/signing.ts";

const KEY = "k".repeat(32);
const offline: typeof fetch = () =>
  Promise.reject(new Error("no network in this test"));
const noSessions = new PlaybackSessions({
  youtube: new YouTube(
    new SessionPool({
      egress: { fetch: () => offline, close: async () => {} },
      createVisitorData: async () => "VD",
    }),
  ),
});

describe("gateway app", () => {
  const app = createApp({ sessions: noSessions, signingKey: KEY });

  it("answers the liveness probe", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 404 for unknown paths", async () => {
    expect((await app.request("/nope")).status).toBe(404);
  });

  it("refuses a manifest without a valid signature", async () => {
    expect(
      (await app.request("/media/v/dQw4w9WgXcQ/manifest.mpd")).status,
    ).toBe(403);
    const exp = Math.floor(Date.now() / 1000) + 60;
    const forged = `/media/v/dQw4w9WgXcQ/manifest.mpd?exp=${exp}&sig=${signPlayback("x".repeat(32), "dQw4w9WgXcQ", exp)}`;
    expect((await app.request(forged)).status).toBe(403);
  });

  it("does not serve media for an unknown session", async () => {
    expect(
      (
        await app.request("/media/s/nope/t/v137", {
          headers: { range: "bytes=0-9" },
        })
      ).status,
    ).toBe(404);
  });
});
