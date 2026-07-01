import { afterEach, describe, expect, it, vi } from "vitest";
import { isStrictShortVideo } from "@/lib/short-video";
import {
  collectRelatedVideoCandidates,
  expandScoredPoolWithRelatedCandidates,
  HOME_RELATED_LIMITS,
} from "@/server/recommendation/collect-related-candidates";
import type { UserSignals } from "@/server/recommendation/signals";
import { buildTfidfModel } from "@/server/recommendation/tfidf";
import type { ScoredVideo } from "@/server/recommendation/types";
import * as proxy from "@/server/services/proxy";

function emptySignals(): UserSignals {
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
  };
}

describe("collectRelatedVideoCandidates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tags related videos with related:seedId and respects caps", async () => {
    const fetchRelatedVideos = vi
      .spyOn(proxy, "fetchRelatedVideos")
      .mockImplementation(async (_db, input) => ({
        videos: [
          {
            videoId: `rel-${input.videoId}-a`,
            title: "Related A",
            durationSeconds: 120,
          },
          {
            videoId: `rel-${input.videoId}-b`,
            title: "Related B",
            durationSeconds: 120,
          },
        ],
        sourceUsed: "piped" as const,
      }));

    const seeds = [
      { videoId: "seed1", rawScore: 1 },
      { videoId: "seed2", rawScore: 0.9 },
    ];
    const tagged = await collectRelatedVideoCandidates({} as never, seeds, {
      ...HOME_RELATED_LIMITS,
      maxSeeds: 2,
      limitPerSeed: 5,
      maxRelatedTotal: 3,
    });

    expect(fetchRelatedVideos).toHaveBeenCalledTimes(2);
    expect(tagged).toHaveLength(3);
    expect(tagged[0]?.source).toBe("related:seed1");
    expect(tagged.every((t) => t.source.startsWith("related:"))).toBe(true);
  });

  it("skips watched ids and pool duplicates", async () => {
    vi.spyOn(proxy, "fetchRelatedVideos").mockResolvedValue({
      videos: [
        { videoId: "dup", title: "Dup" },
        { videoId: "watched", title: "Watched" },
        { videoId: "fresh", title: "Fresh" },
      ],
      sourceUsed: "piped",
    });

    const tagged = await collectRelatedVideoCandidates(
      {} as never,
      [{ videoId: "seed", rawScore: 1 }],
      {
        ...HOME_RELATED_LIMITS,
        maxSeeds: 1,
        excludeVideoIds: new Set(["watched"]),
        excludeFromPool: new Set(["dup"]),
      },
    );

    expect(tagged.map((t) => t.video.videoId)).toEqual(["fresh"]);
  });

  it("filters to strict shorts when filterVideo is set", async () => {
    vi.spyOn(proxy, "fetchRelatedVideos").mockResolvedValue({
      videos: [
        { videoId: "long", title: "Long", durationSeconds: 600 },
        { videoId: "short", title: "Clip #shorts", durationSeconds: 30 },
      ],
      sourceUsed: "piped",
    });

    const tagged = await collectRelatedVideoCandidates(
      {} as never,
      [{ videoId: "seed", rawScore: 1 }],
      {
        ...HOME_RELATED_LIMITS,
        maxSeeds: 1,
        filterVideo: isStrictShortVideo,
      },
    );

    expect(tagged.map((t) => t.video.videoId)).toEqual(["short"]);
  });
});

describe("expandScoredPoolWithRelatedCandidates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns unchanged pool on cold start", async () => {
    const scored: ScoredVideo[] = [{ videoId: "a", title: "A", rawScore: 1 }];
    const result = await expandScoredPoolWithRelatedCandidates({
      db: {} as never,
      scored,
      coldStart: true,
      limits: HOME_RELATED_LIMITS,
      excludeVideoIds: new Set(),
      signals: emptySignals(),
      tasteModel: buildTfidfModel([]),
      maxCh: 1,
      scoreContext: { recentCoverageByChannel: new Map() },
    });
    expect(result.stats).toBeNull();
    expect(result.scored).toBe(scored);
  });

  it("merges and boosts new related rows", async () => {
    vi.spyOn(proxy, "fetchRelatedVideos").mockResolvedValue({
      videos: [{ videoId: "new-related", title: "New related topic" }],
      sourceUsed: "piped",
    });

    const scored: ScoredVideo[] = [
      {
        videoId: "seed-top",
        title: "Seed",
        rawScore: 2,
        candidateSource: "trending",
      },
    ];

    const result = await expandScoredPoolWithRelatedCandidates({
      db: {} as never,
      scored,
      coldStart: false,
      limits: { ...HOME_RELATED_LIMITS, maxSeeds: 1 },
      excludeVideoIds: new Set(),
      signals: emptySignals(),
      tasteModel: buildTfidfModel(["topic"]),
      maxCh: 1,
      scoreContext: { recentCoverageByChannel: new Map() },
      minScoredForExpansion: 1,
    });

    expect(result.stats?.added).toBe(1);
    expect(result.scored.some((s) => s.videoId === "new-related")).toBe(true);
    const related = result.scored.find((s) => s.videoId === "new-related");
    expect(related?.candidateSource).toBe("related:seed-top");
    expect(related?.rawScore).toBeGreaterThan(0);
  });
});
