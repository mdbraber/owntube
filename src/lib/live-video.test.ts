import { describe, expect, it } from "vitest";
import {
  isActiveLiveVideo,
  normalizeDurationForLive,
  pickLiveFlagsFromUpstream,
} from "@/lib/live-video";

describe("normalizeDurationForLive", () => {
  it("clears zero duration for active live", () => {
    expect(normalizeDurationForLive(0, true)).toBeUndefined();
    expect(normalizeDurationForLive(120, true)).toBe(120);
  });

  it("keeps duration for VOD", () => {
    expect(normalizeDurationForLive(0, false)).toBe(0);
  });
});

describe("isActiveLiveVideo", () => {
  it("excludes upcoming", () => {
    expect(isActiveLiveVideo({ isLive: true, isUpcoming: true })).toBe(false);
    expect(isActiveLiveVideo({ isLive: true })).toBe(true);
  });
});

describe("pickLiveFlagsFromUpstream", () => {
  it("reads Piped livestream", () => {
    expect(pickLiveFlagsFromUpstream({ livestream: true })).toEqual({
      isLive: true,
      isUpcoming: false,
    });
  });

  it("reads Invidious liveNow and isUpcoming", () => {
    expect(pickLiveFlagsFromUpstream({ liveNow: true })).toEqual({
      isLive: true,
      isUpcoming: false,
    });
    expect(
      pickLiveFlagsFromUpstream({ liveNow: true, isUpcoming: true }),
    ).toEqual({
      isLive: false,
      isUpcoming: true,
    });
  });
});
