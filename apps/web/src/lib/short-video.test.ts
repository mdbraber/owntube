import { describe, expect, it } from "vitest";
import {
  filterShortsFeedVideos,
  isDiscoveryShortVideo,
  isStrictShortVideo,
  MAX_SHORT_DURATION_SECONDS,
} from "@/lib/short-video";
import type { UnifiedVideo } from "@/server/services/proxy.types";

describe("isStrictShortVideo", () => {
  it("accepts short duration", () => {
    expect(
      isStrictShortVideo({
        videoId: "a",
        title: "clip",
        durationSeconds: 45,
      } as UnifiedVideo),
    ).toBe(true);
  });

  it("rejects long uploads", () => {
    expect(
      isStrictShortVideo({
        videoId: "b",
        title: "long",
        durationSeconds: MAX_SHORT_DURATION_SECONDS + 1,
      } as UnifiedVideo),
    ).toBe(false);
  });

  it("accepts #shorts in title when duration unknown", () => {
    expect(
      isStrictShortVideo({
        videoId: "c",
        title: "fun #shorts",
      } as UnifiedVideo),
    ).toBe(true);
  });

  it("accepts #shorts when Piped sends duration -1", () => {
    expect(
      isStrictShortVideo({
        videoId: "e",
        title: "clip #shorts",
        durationSeconds: -1,
      } as UnifiedVideo),
    ).toBe(true);
  });

  it("rejects long uploads even with Shorts in the title", () => {
    expect(
      isStrictShortVideo({
        videoId: "f",
        title: "200 secrets from YouTube Shorts",
        durationSeconds: 1222,
      } as UnifiedVideo),
    ).toBe(false);
  });
});

describe("isDiscoveryShortVideo", () => {
  it("accepts 75s clips when strict rejects", () => {
    const v = {
      videoId: "d",
      title: "clip",
      durationSeconds: 75,
    } as UnifiedVideo;
    expect(isStrictShortVideo(v)).toBe(false);
    expect(isDiscoveryShortVideo(v)).toBe(true);
  });
});

describe("filterShortsFeedVideos", () => {
  it("falls back to discovery when strict filter would empty the list", () => {
    const videos = filterShortsFeedVideos([
      { videoId: "a", title: "a", durationSeconds: 75 } as UnifiedVideo,
    ]);
    expect(videos).toHaveLength(1);
  });

  it("drops unknown-duration search hits without a #shorts tag", () => {
    const videos = filterShortsFeedVideos([
      {
        videoId: "b",
        title: "clip sans hashtag",
        durationSeconds: -1,
      } as UnifiedVideo,
    ]);
    expect(videos).toHaveLength(0);
  });

  it("keeps unknown-duration rows when they include #shorts", () => {
    const videos = filterShortsFeedVideos([
      {
        videoId: "c",
        title: "fun #shorts",
        durationSeconds: -1,
      } as UnifiedVideo,
    ]);
    expect(videos).toHaveLength(1);
  });
});
