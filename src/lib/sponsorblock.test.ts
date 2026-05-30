import { describe, expect, it } from "vitest";
import {
  decideSponsorBlockSkip,
  findPrefixResponseForVideo,
  normalizeSponsorBlockSegments,
  segmentAtTime,
} from "@/lib/sponsorblock";
import {
  hashPrefixForVideoId,
  sha256VideoIdHex,
} from "@/lib/sponsorblock-hash";

const TEST_VIDEO_ID = "dQw4w9WgXcQ";

describe("sponsorblock hash", () => {
  it("computes stable SHA-256 for video id", () => {
    const hash = sha256VideoIdHex(TEST_VIDEO_ID);
    expect(hash).toHaveLength(64);
    expect(hashPrefixForVideoId(TEST_VIDEO_ID, 4)).toBe(hash.slice(0, 4));
  });

  it("finds matching entry from prefix bulk response", () => {
    const fullHash = sha256VideoIdHex(TEST_VIDEO_ID);
    const entries = [
      {
        videoID: "other",
        hash: "abc123",
        segments: [],
      },
      {
        videoID: TEST_VIDEO_ID,
        hash: fullHash,
        segments: [
          {
            segment: [10, 20],
            UUID: "seg-1",
            category: "sponsor",
            actionType: "skip",
          },
        ],
      },
    ];
    const match = findPrefixResponseForVideo(entries, fullHash, TEST_VIDEO_ID);
    expect(match?.hash).toBe(fullHash);
    expect(match?.segments).toHaveLength(1);
  });
});

describe("normalizeSponsorBlockSegments", () => {
  it("keeps skip segments in enabled categories", () => {
    const out = normalizeSponsorBlockSegments(
      [
        {
          segment: [1, 5],
          UUID: "a",
          category: "sponsor",
          actionType: "skip",
        },
        {
          segment: [6, 10],
          UUID: "b",
          category: "intro",
          actionType: "skip",
        },
        {
          segment: [11, 15],
          UUID: "c",
          category: "filler",
          actionType: "skip",
        },
        {
          segment: [16, 20],
          UUID: "d",
          category: "sponsor",
          actionType: "mute",
        },
      ],
      { categories: ["sponsor", "intro"] },
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.category).toBe("sponsor");
    expect(out[1]?.category).toBe("intro");
  });

  it("clamps segments to duration when provided", () => {
    const out = normalizeSponsorBlockSegments(
      [
        {
          segment: [90, 120],
          UUID: "a",
          category: "sponsor",
          actionType: "skip",
        },
      ],
      { categories: ["sponsor"], durationSeconds: 100 },
    );
    expect(out[0]?.endSeconds).toBe(100);
  });

  it("rejects invalid segments", () => {
    const out = normalizeSponsorBlockSegments(
      [
        {
          segment: [10, 5],
          UUID: "a",
          category: "sponsor",
          actionType: "skip",
        },
        { segment: [1, 2], UUID: "", category: "sponsor", actionType: "skip" },
      ],
      { categories: ["sponsor"] },
    );
    expect(out).toHaveLength(0);
  });
});

describe("segmentAtTime", () => {
  const segments = normalizeSponsorBlockSegments(
    [
      {
        segment: [10, 20],
        UUID: "a",
        category: "sponsor",
        actionType: "skip",
      },
    ],
    { categories: ["sponsor"] },
  );

  it("returns segment when time is inside range", () => {
    expect(segmentAtTime(segments, 15)?.uuid).toBe("a");
  });

  it("returns null outside range", () => {
    expect(segmentAtTime(segments, 5)).toBeNull();
    expect(segmentAtTime(segments, 20)).toBeNull();
  });
});

describe("decideSponsorBlockSkip", () => {
  const segments = normalizeSponsorBlockSegments(
    [
      {
        segment: [10, 20],
        UUID: "a",
        category: "sponsor",
        actionType: "skip",
      },
    ],
    { categories: ["sponsor"] },
  );

  it("skips when inside segment and enabled", () => {
    const decision = decideSponsorBlockSkip({
      currentTime: 12,
      segments,
      skippedUuids: new Set(),
      isScrubbing: false,
      enabled: true,
      autoSkip: true,
      paused: false,
    });
    expect(decision?.segment.uuid).toBe("a");
    expect(decision?.seekTo).toBeGreaterThan(20);
  });

  it("does not skip when already skipped", () => {
    const decision = decideSponsorBlockSkip({
      currentTime: 12,
      segments,
      skippedUuids: new Set(["a"]),
      isScrubbing: false,
      enabled: true,
      autoSkip: true,
      paused: false,
    });
    expect(decision).toBeNull();
  });

  it("does not skip while scrubbing", () => {
    const decision = decideSponsorBlockSkip({
      currentTime: 12,
      segments,
      skippedUuids: new Set(),
      isScrubbing: true,
      enabled: true,
      autoSkip: true,
      paused: false,
    });
    expect(decision).toBeNull();
  });

  it("does not skip when disabled or paused", () => {
    expect(
      decideSponsorBlockSkip({
        currentTime: 12,
        segments,
        skippedUuids: new Set(),
        isScrubbing: false,
        enabled: false,
        autoSkip: true,
        paused: false,
      }),
    ).toBeNull();
    expect(
      decideSponsorBlockSkip({
        currentTime: 12,
        segments,
        skippedUuids: new Set(),
        isScrubbing: false,
        enabled: true,
        autoSkip: true,
        paused: true,
      }),
    ).toBeNull();
  });
});
