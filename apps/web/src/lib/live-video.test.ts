import { describe, expect, it } from "vitest";
import {
  isActiveLiveVideo,
  markUnifiedVideoAsActiveLive,
  mergeActiveLiveVideosFirst,
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

  it("reads Piped isLive alias", () => {
    expect(pickLiveFlagsFromUpstream({ isLive: true })).toEqual({
      isLive: true,
      isUpcoming: false,
    });
  });

  it("does not infer live from Piped stream type with missing duration", () => {
    expect(pickLiveFlagsFromUpstream({ type: "stream", duration: 0 })).toEqual({
      isLive: false,
      isUpcoming: false,
    });
    expect(pickLiveFlagsFromUpstream({ type: "stream", duration: -1 })).toEqual(
      {
        isLive: false,
        isUpcoming: false,
      },
    );
  });

  it("infers live from Piped trending streams with duration and uploaded both -1", () => {
    // Shape of a regional-trending live TV item (e.g. "atv Canlı Yayın").
    expect(
      pickLiveFlagsFromUpstream({
        type: "stream",
        duration: -1,
        uploaded: -1,
      }),
    ).toEqual({ isLive: true, isUpcoming: false });
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

type LiveMergeFixture = {
  videoId: string;
  title?: string;
  durationSeconds?: number;
  isLive?: boolean;
  isUpcoming?: boolean;
};

describe("mergeActiveLiveVideosFirst", () => {
  it("prepends live-only rows and tags duplicates", () => {
    const merged = mergeActiveLiveVideosFirst<LiveMergeFixture>(
      [
        {
          videoId: "upload1",
          title: "Upload",
          durationSeconds: 600,
        },
        {
          videoId: "live1",
          title: "Live duplicate",
          durationSeconds: 0,
        },
      ],
      [
        {
          videoId: "live1",
          title: "Live now",
          durationSeconds: 0,
        },
        {
          videoId: "live2",
          title: "Other live",
          durationSeconds: 0,
        },
      ],
    );
    expect(merged.map((v) => v.videoId)).toEqual(["live2", "upload1", "live1"]);
    expect(merged.find((v) => v.videoId === "live1")?.isLive).toBe(true);
    expect(merged.find((v) => v.videoId === "live1")?.durationSeconds).toBe(
      undefined,
    );
  });

  it("marks channel-tab live rows even without upstream flags", () => {
    const merged = mergeActiveLiveVideosFirst<LiveMergeFixture>(
      [],
      [{ videoId: "liveOnly", title: "Live", durationSeconds: 0 }],
    );
    expect(merged[0]?.isLive).toBe(true);
    expect(merged[0]?.durationSeconds).toBeUndefined();
  });
});

describe("markUnifiedVideoAsActiveLive", () => {
  it("skips upcoming premieres", () => {
    const row = markUnifiedVideoAsActiveLive<LiveMergeFixture>({
      videoId: "x",
      isUpcoming: true,
      durationSeconds: 0,
    });
    expect(row.isLive).toBeUndefined();
  });
});
