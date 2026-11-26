import { describe, expect, it } from "vitest";
import {
  aspectRatioFromPixelDimensions,
  inferShortAspectRatioFromDetail,
} from "@/lib/short-video-aspect";
import type { VideoDetail } from "@/server/catalog/types";

describe("aspectRatioFromPixelDimensions", () => {
  it("returns width over height", () => {
    expect(aspectRatioFromPixelDimensions(1080, 1920)).toBeCloseTo(9 / 16);
    expect(aspectRatioFromPixelDimensions(1920, 1080)).toBeCloseTo(16 / 9);
  });
});

describe("inferShortAspectRatioFromDetail", () => {
  // Always vertical until real <video> intrinsics arrive; a landscape clip is
  // corrected on loadedmetadata via aspectRatioFromPixelDimensions.
  it("assumes vertical", () => {
    const detail = { videoId: "dQw4w9WgXcQ", title: "t" } as VideoDetail;
    expect(inferShortAspectRatioFromDetail(detail)).toBeCloseTo(9 / 16);
    expect(inferShortAspectRatioFromDetail(undefined)).toBeCloseTo(9 / 16);
  });
});
