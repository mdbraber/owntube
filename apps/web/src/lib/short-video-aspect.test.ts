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
  // Always vertical until real <video> intrinsics arrive: stream height is an
  // unreliable orientation signal for shorts and guessing landscape made the
  // frame flash wide-then-tall. A genuinely landscape clip is corrected on
  // loadedmetadata via aspectRatioFromPixelDimensions.
  it("assumes vertical when height metadata is tall", () => {
    const detail = {
      videoSources: [{ url: "https://example.com/v.mp4", height: 1920 }],
    } as VideoDetail;
    expect(inferShortAspectRatioFromDetail(detail)).toBeCloseTo(9 / 16);
  });

  it("assumes vertical even when height metadata reads short", () => {
    const detail = {
      videoSources: [{ url: "https://example.com/v.mp4", height: 360 }],
    } as VideoDetail;
    expect(inferShortAspectRatioFromDetail(detail)).toBeCloseTo(9 / 16);
  });

  it("assumes vertical when no stream metadata is present", () => {
    expect(inferShortAspectRatioFromDetail(undefined)).toBeCloseTo(9 / 16);
  });
});
