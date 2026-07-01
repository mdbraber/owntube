import { describe, expect, it } from "vitest";
import { isSameOriginMediaSrc } from "@/lib/audio-peak-limiter";

const ORIGIN = "https://owntube.example";

describe("isSameOriginMediaSrc", () => {
  it("accepts MSE blob URLs (hls.js, untainted)", () => {
    expect(isSameOriginMediaSrc(`blob:${ORIGIN}/abc-123`, ORIGIN)).toBe(true);
  });

  it("accepts same-origin proxy URLs", () => {
    expect(
      isSameOriginMediaSrc(`${ORIGIN}/invidious/videoplayback?id=1`, ORIGIN),
    ).toBe(true);
    expect(isSameOriginMediaSrc("/yt-hls?url=x", ORIGIN)).toBe(true);
  });

  it("rejects cross-origin direct URLs (would silence via Web Audio)", () => {
    expect(
      isSameOriginMediaSrc("https://r1.googlevideo.com/videoplayback", ORIGIN),
    ).toBe(false);
  });

  it("rejects empty / missing sources and unknown origins", () => {
    expect(isSameOriginMediaSrc("", ORIGIN)).toBe(false);
    expect(isSameOriginMediaSrc(null, ORIGIN)).toBe(false);
    expect(isSameOriginMediaSrc(undefined, ORIGIN)).toBe(false);
    expect(isSameOriginMediaSrc(`${ORIGIN}/x.mp4`, "")).toBe(false);
  });
});
