import { describe, expect, it } from "vitest";
import type { UserSignals } from "@/server/recommendation/signals";
import { buildTfidfModel } from "@/server/recommendation/tfidf";
import {
  filterTrendingTailByTaste,
  mergePersonalizedWithTrendingTail,
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

describe("filterTrendingTailByTaste", () => {
  const taste = buildTfidfModel([
    "rust async runtime tokio",
    "rust ownership and borrowing",
  ]);

  it("drops off-taste rows and keeps on-taste rows in order", () => {
    const pool = [
      { videoId: "off1", channelId: "UCx", title: "regional pop hit" },
      { videoId: "on1", channelId: "UCy", title: "rust async deep dive" },
      { videoId: "off2", channelId: "UCz", title: "celebrity gossip clip" },
      { videoId: "on2", channelId: "UCfan", title: "unrelated upload" },
    ];
    const kept = filterTrendingTailByTaste(
      pool,
      signalsWithHistory({ channelWeights: new Map([["UCfan", 5]]) }),
      taste,
      new Set(),
    );
    // on1 matches on title; on2 is kept via its high-affinity channel (UCfan).
    expect(kept.map((v) => v.videoId)).toEqual(["on1", "on2"]);
  });

  it("keeps everything during cold start", () => {
    const pool = [
      { videoId: "a12345", title: "regional pop hit" },
      { videoId: "b12345", title: "rust async deep dive" },
    ];
    const kept = filterTrendingTailByTaste(
      pool,
      signalsWithHistory({ totalWatches: 3 }),
      taste,
      new Set(),
    );
    expect(kept.map((v) => v.videoId)).toEqual(["a12345", "b12345"]);
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
