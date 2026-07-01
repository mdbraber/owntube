import { describe, expect, it } from "vitest";
import type { UserSignals } from "@/server/recommendation/signals";
import { buildTfidfModel } from "@/server/recommendation/tfidf";
import {
  mergePersonalizedWithTrendingTail,
  partitionTrendingTailByTaste,
} from "@/server/trpc/routers/feed";

function signalsWithHistory(overrides: Partial<UserSignals> = {}): UserSignals {
  return {
    channelWeights: new Map(),
    totalWatches: 20,
    watchedVideoIds: new Set(),
    watchedVideoLastSeen: new Map(),
    distinctWatchesByChannel: new Map(),
    totalDistinctVideosWatched: 0,
    channelLastWatchedAt: new Map(),
    channelsOrderedByRecentWatch: [],
    historyChannelIds: new Set(),
    likedVideoIds: new Set(),
    dislikedVideoIds: new Set(),
    savedVideoIds: new Set(),
    interactionInterestChannelIds: new Set(),
    quickSkipVideoIds: new Set(),
    ...overrides,
  };
}

describe("partitionTrendingTailByTaste", () => {
  const taste = buildTfidfModel([
    "rust async runtime tokio",
    "rust ownership and borrowing",
  ]);

  it("moves off-taste rows behind on-taste rows without dropping any", () => {
    const pool = [
      { videoId: "off1", channelId: "UCx", title: "regional pop hit" },
      { videoId: "on1", channelId: "UCy", title: "rust async deep dive" },
      { videoId: "off2", channelId: "UCz", title: "celebrity gossip clip" },
      { videoId: "on2", channelId: "UCfan", title: "unrelated upload" },
    ];
    const ordered = partitionTrendingTailByTaste(
      pool,
      signalsWithHistory({ channelWeights: new Map([["UCfan", 5]]) }),
      taste,
      new Set(),
    );
    expect(ordered.map((v) => v.videoId)).toEqual([
      "on1",
      "on2",
      "off1",
      "off2",
    ]);
  });

  it("keeps the original order during cold start", () => {
    const pool = [
      { videoId: "a12345", title: "regional pop hit" },
      { videoId: "b12345", title: "rust async deep dive" },
    ];
    const ordered = partitionTrendingTailByTaste(
      pool,
      signalsWithHistory({ totalWatches: 3 }),
      taste,
      new Set(),
    );
    expect(ordered.map((v) => v.videoId)).toEqual(["a12345", "b12345"]);
  });
});

describe("mergePersonalizedWithTrendingTail", () => {
  it("appends tail rows without duplicating personalized ids", () => {
    const merged = mergePersonalizedWithTrendingTail(
      [{ videoId: "p1", title: "P1" }],
      [
        { videoId: "p1", title: "P1 dup" },
        { videoId: "t1", title: "T1" },
      ],
    );
    expect(merged.map((v) => v.videoId)).toEqual(["p1", "t1"]);
  });
});
