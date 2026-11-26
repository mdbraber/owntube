import { afterEach, describe, expect, it, vi } from "vitest";
import { isStrictShortVideo } from "@/lib/short-video";
import * as catalog from "@/server/catalog";
import {
  collectRelatedVideoCandidates,
  expandScoredPoolWithRelatedCandidates,
  HOME_RELATED_LIMITS,
  pickRelatedSeeds,
} from "@/server/recommendation/collect-related-candidates";
import type { UserSignals } from "@/server/recommendation/signals";
import { buildTfidfModel } from "@/server/recommendation/tfidf";
import type { ScoredVideo } from "@/server/recommendation/types";

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
    channelsOrderedByWeight: [],
    recentEngagedVideoIds: [],
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
      .spyOn(catalog, "fetchRelatedVideos")
      .mockImplementation(async (input) => ({
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
      }));

    const seeds = [
      { videoId: "seed1", rawScore: 1 },
      { videoId: "seed2", rawScore: 0.9 },
    ];
    const tagged = await collectRelatedVideoCandidates(seeds, {
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
    vi.spyOn(catalog, "fetchRelatedVideos").mockResolvedValue({
      videos: [
        { videoId: "dup", title: "Dup" },
        { videoId: "watched", title: "Watched" },
        { videoId: "fresh", title: "Fresh" },
      ],
    });

    const tagged = await collectRelatedVideoCandidates(
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
    vi.spyOn(catalog, "fetchRelatedVideos").mockResolvedValue({
      videos: [
        { videoId: "long", title: "Long", durationSeconds: 600 },
        { videoId: "short", title: "Clip #shorts", durationSeconds: 30 },
      ],
    });

    const tagged = await collectRelatedVideoCandidates(
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
    vi.spyOn(catalog, "fetchRelatedVideos").mockResolvedValue({
      videos: [{ videoId: "new-related", title: "New related topic" }],
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

describe("pickRelatedSeeds / history seeds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("puts watched seeds first with the full boost, then fills from the pool", () => {
    const scored = [
      { videoId: "pool1", rawScore: 0.9 },
      { videoId: "pool2", rawScore: 0.8 },
      { videoId: "pool3", rawScore: 0.7 },
    ];
    const seeds = pickRelatedSeeds(
      scored,
      ["hist1", "pool2", "hist2", "hist3"],
      {
        maxSeeds: 4,
        maxHistorySeeds: 2,
      },
    );
    expect(seeds.map((s) => s.videoId)).toEqual([
      "hist1",
      "pool2",
      "pool1",
      "pool3",
    ]);
    expect(seeds[0]).toMatchObject({ rawScore: 0.9, fromHistory: true });
    // A pool row that is also a history seed is not duplicated.
    expect(seeds.filter((s) => s.videoId === "pool2")).toHaveLength(1);
    expect(seeds[1]?.fromHistory).toBe(true);
  });

  it("takes subscription seeds before history seeds, each within its cap", () => {
    const seeds = pickRelatedSeeds(
      [
        { videoId: "pool1", rawScore: 0.9 },
        { videoId: "pool2", rawScore: 0.5 },
      ],
      ["hist1", "hist2", "hist3"],
      { maxSeeds: 6, maxSubscriptionSeeds: 3, maxHistorySeeds: 2 },
      [
        { videoId: "sub1", channelName: "A" },
        { videoId: "sub2", channelName: "B" },
        { videoId: "sub3" },
        { videoId: "sub4" },
      ],
    );
    expect(seeds.map((s) => s.videoId)).toEqual([
      "sub1",
      "sub2",
      "sub3",
      "hist1",
      "hist2",
      "pool1",
    ]);
    expect(seeds[0]).toMatchObject({
      rawScore: 0.9,
      fromSubscription: true,
      subscriptionChannelName: "A",
    });
  });

  it("labels rows related to a subscription upload with that channel", async () => {
    vi.spyOn(catalog, "fetchRelatedVideos").mockImplementation(
      async (input) => ({
        videos: [
          {
            videoId: `rel-${input.videoId}`,
            title: `Something else ${input.videoId}`,
            channelId: "UCother",
            channelName: "Other",
            durationSeconds: 300,
          },
        ],
      }),
    );
    const scored: ScoredVideo[] = Array.from({ length: 8 }, (_, i) => ({
      videoId: `pool${i}`,
      title: `Pool ${i}`,
      rawScore: 1 - i * 0.05,
    }));
    const { scored: expanded } = await expandScoredPoolWithRelatedCandidates({
      db: {} as never,
      scored,
      coldStart: false,
      limits: {
        maxSeeds: 2,
        maxSubscriptionSeeds: 1,
        maxHistorySeeds: 1,
        limitPerSeed: 5,
        maxRelatedTotal: 10,
      },
      // The subscription seed was watched: it still expands.
      excludeVideoIds: new Set(["sub1", "hist1"]),
      historySeedVideoIds: ["hist1"],
      subscriptionSeeds: [{ videoId: "sub1", channelName: "Subbed" }],
      signals: emptySignals(),
      tasteModel: buildTfidfModel(["pool"]),
      maxCh: 1,
      scoreContext: { recentCoverageByChannel: new Map() },
    });
    const fromSub = expanded.find((r) => r.videoId === "rel-sub1");
    const fromHist = expanded.find((r) => r.videoId === "rel-hist1");
    expect(fromSub?.recommendationReason).toEqual({
      kind: "related",
      channelName: "Subbed",
    });
    expect(fromHist?.recommendationReason?.channelName).toBeUndefined();
    expect(fromSub?.rawScore ?? 0).toBeGreaterThan(fromHist?.rawScore ?? 0);
  });

  it("uses pool seeds only when no history cap is set", () => {
    const seeds = pickRelatedSeeds(
      [{ videoId: "pool1", rawScore: 1 }],
      ["hist1"],
      { maxSeeds: 2 },
    );
    expect(seeds.map((s) => s.videoId)).toEqual(["pool1"]);
  });

  it("expands from watched seeds even though they sit in the excluded set", async () => {
    const fetchRelatedVideos = vi
      .spyOn(catalog, "fetchRelatedVideos")
      .mockImplementation(async (input) => ({
        videos: [
          {
            videoId: `rel-${input.videoId}`,
            title: `Related to ${input.videoId}`,
            durationSeconds: 300,
          },
        ],
      }));

    const scored: ScoredVideo[] = Array.from({ length: 8 }, (_, i) => ({
      videoId: `pool${i}`,
      title: `Pool ${i}`,
      rawScore: 1 - i * 0.05,
    }));
    const { scored: expanded, stats } =
      await expandScoredPoolWithRelatedCandidates({
        db: {} as never,
        scored,
        coldStart: false,
        limits: {
          maxSeeds: 3,
          maxHistorySeeds: 2,
          limitPerSeed: 5,
          maxRelatedTotal: 10,
        },
        excludeVideoIds: new Set(["watched1", "watched2"]),
        historySeedVideoIds: ["watched1", "watched2"],
        signals: emptySignals(),
        tasteModel: buildTfidfModel(["pool"]),
        maxCh: 1,
        scoreContext: { recentCoverageByChannel: new Map() },
      });

    const seededIds = fetchRelatedVideos.mock.calls.map((c) => c[0].videoId);
    expect(seededIds).toEqual(["watched1", "watched2", "pool0"]);
    expect(stats?.added).toBe(3);
    const sources = expanded
      .filter((r) => r.candidateSource?.startsWith("related:"))
      .map((r) => r.candidateSource);
    expect(sources).toContain("related:watched1");
    expect(sources).toContain("related:watched2");
  });
});
