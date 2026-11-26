import { describe, expect, it } from "vitest";
import {
  isActiveLiveVideo,
  markUnifiedVideoAsActiveLive,
  mergeActiveLiveVideosFirst,
  normalizeDurationForLive,
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
