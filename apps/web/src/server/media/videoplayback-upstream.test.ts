import { afterEach, describe, expect, it } from "vitest";
import { videoplaybackUpstreamBase } from "@/server/media/upstream-proxy";

const ENV = [
  "INVIDIOUS_COMPANION_INTERNAL_URL",
  "INVIDIOUS_PUBLIC_BASE_URL",
  "OWNTUBE_VIDEOPLAYBACK_VIA_COMPANION",
] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

describe("videoplaybackUpstreamBase", () => {
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("sends videoplayback to the companion's internal address", () => {
    process.env.INVIDIOUS_COMPANION_INTERNAL_URL =
      "http://invidious-companion:8282/";
    expect(videoplaybackUpstreamBase("videoplayback")).toBe(
      "http://invidious-companion:8282/companion",
    );
  });

  it("falls back to the public companion base", () => {
    delete process.env.INVIDIOUS_COMPANION_INTERNAL_URL;
    process.env.INVIDIOUS_PUBLIC_BASE_URL = "https://inv.example";
    expect(videoplaybackUpstreamBase("videoplayback")).toBe(
      "https://inv.example/companion",
    );
  });

  it("leaves everything else, an opt-out and no companion to Invidious", () => {
    process.env.INVIDIOUS_COMPANION_INTERNAL_URL =
      "http://invidious-companion:8282";
    expect(videoplaybackUpstreamBase("vi/abc/hqdefault.jpg")).toBeNull();
    expect(videoplaybackUpstreamBase("api/manifest/hls/x.m3u8")).toBeNull();
    process.env.OWNTUBE_VIDEOPLAYBACK_VIA_COMPANION = "false";
    expect(videoplaybackUpstreamBase("videoplayback")).toBeNull();
    delete process.env.OWNTUBE_VIDEOPLAYBACK_VIA_COMPANION;
    delete process.env.INVIDIOUS_COMPANION_INTERNAL_URL;
    delete process.env.INVIDIOUS_PUBLIC_BASE_URL;
    expect(videoplaybackUpstreamBase("videoplayback")).toBeNull();
  });
});
