import { describe, expect, it } from "vitest";
import {
  aspectRatioFromPixelDimensions,
  inferShortAspectRatioFromDetail,
} from "@/lib/short-video-aspect";
import type { VideoDetail } from "@/server/services/proxy.types";

describe("aspectRatioFromPixelDimensions", () => {
  it("returns width over height", () => {
    expect(aspectRatioFromPixelDimensions(1080, 1920)).toBeCloseTo(9 / 16);
    expect(aspectRatioFromPixelDimensions(1920, 1080)).toBeCloseTo(16 / 9);
  });
});

describe("inferShortAspectRatioFromDetail", () => {
  it("prefers vertical when stream height is tall", () => {
    const detail = {
      videoSources: [{ url: "https://example.com/v.mp4", height: 1920 }],
    } as VideoDetail;
    expect(inferShortAspectRatioFromDetail(detail)).toBeCloseTo(9 / 16);
  });

  it("prefers landscape when stream height is short", () => {
    const detail = {
      videoSources: [{ url: "https://example.com/v.mp4", height: 360 }],
    } as VideoDetail;
    expect(inferShortAspectRatioFromDetail(detail)).toBeCloseTo(16 / 9);
  });
});
