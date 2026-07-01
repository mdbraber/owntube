import { describe, expect, it } from "vitest";
import {
  isLikelyShortVideo,
  isUnvettedKeywordSpam,
  keepCandidateForTrendingTail,
  keywordDiscoveryScorePenalty,
  publicationFreshnessScore,
  scoreCandidate,
  scoreCandidateDetail,
  watchedRepeatPenalty,
} from "@/server/recommendation/scoring";
import type { UserSignals } from "@/server/recommendation/signals";
import { buildTfidfModel } from "@/server/recommendation/tfidf";

function emptySignals(overrides: Partial<UserSignals> = {}): UserSignals {
  return {
    channelWeights: new Map(),
    totalWatches: 0,
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

describe("scoring", () => {
  it("ranks more recently published text higher when parseable", () => {
    expect(publicationFreshnessScore("2 hours ago")).toBeGreaterThan(
      publicationFreshnessScore("5 days ago"),
    );
    expect(publicationFreshnessScore("1 day ago")).toBeGreaterThan(
      publicationFreshnessScore("21 days ago"),
    );
  });

  it("prefers numeric publishedAt over publishedText when available", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // publishedText lies ("old"), but the numeric timestamp says ~1h old.
    const recent = publicationFreshnessScore("3 years ago", nowSec - 3600);
    const stale = publicationFreshnessScore(
      "3 years ago",
      nowSec - 200 * 24 * 3600,
    );
    expect(recent).toBeGreaterThan(stale);
    // Localized/unparseable text falls back to the timestamp instead of default.
    expect(
      publicationFreshnessScore("il y a 1 heure", nowSec - 3600),
    ).toBeGreaterThan(publicationFreshnessScore("il y a 1 heure"));
  });

  it("amplifies on-topic title similarity (content gain)", () => {
    const signals = emptySignals({ totalWatches: 20 });
    const corpus = buildTfidfModel([
      "rust async runtime tokio",
      "rust ownership and borrowing",
    ]);
    const onTopic = scoreCandidateDetail(
      { videoId: "a", title: "rust async runtime deep dive", viewCount: 100 },
      signals,
      corpus,
      1,
    );
    const offTopic = scoreCandidateDetail(
      { videoId: "b", title: "pasta carbonara recipe", viewCount: 100 },
      signals,
      corpus,
      1,
    );
    expect(onTopic.breakdown.components.titleSimilarity).toBeGreaterThan(
      offTopic.breakdown.components.titleSimilarity,
    );
    // Gain pushes a clear match toward the full title weight (0.42).
    expect(onTopic.breakdown.components.titleSimilarity).toBeGreaterThan(0.2);
  });

  it("penalizes titles resembling disliked titles", () => {
    const signals = emptySignals({ totalWatches: 20 });
    const taste = buildTfidfModel(["cooking pasta", "garden tips"]);
    // TF-IDF needs ≥2 docs with distinguishing tokens to produce non-zero idf.
    const dislike = buildTfidfModel([
      "crypto pump and dump scam",
      "crypto rug pull scam warning",
    ]);
    const video = {
      videoId: "v",
      title: "crypto pump and dump scam exposed",
      viewCount: 100,
    };
    const withDislike = scoreCandidate(
      video,
      signals,
      taste,
      1,
      undefined,
      dislike,
    );
    const withoutDislike = scoreCandidate(video, signals, taste, 1);
    expect(withDislike).toBeLessThan(withoutDislike);
  });

  it("detects likely shorts from duration or title", () => {
    expect(
      isLikelyShortVideo({
        videoId: "a",
        title: "Clip",
        durationSeconds: 45,
      }),
    ).toBe(true);
    expect(
      isLikelyShortVideo({
        videoId: "b",
        title: "Something #shorts",
      }),
    ).toBe(true);
  });

  it("watched repeat penalty decays with age", () => {
    const now = 1_700_000_000;
    const last = new Map([["vid1", now - 60]]);
    const fresh = watchedRepeatPenalty("vid1", last, now);
    const old = watchedRepeatPenalty(
      "vid1",
      new Map([["vid1", now - 20 * 24 * 3600]]),
      now,
    );
    expect(fresh).toBeGreaterThan(old);
    expect(watchedRepeatPenalty("unknown", last, now)).toBe(0);
    // Slow decay: a 3-week-old watch still carries a meaningful penalty.
    expect(
      watchedRepeatPenalty(
        "vid1",
        new Map([["vid1", now - 21 * 24 * 3600]]),
        now,
      ),
    ).toBeGreaterThanOrEqual(0.3);
    // Floor: even a watch from months ago never fully disappears...
    expect(
      watchedRepeatPenalty(
        "vid1",
        new Map([["vid1", now - 90 * 24 * 3600]]),
        now,
      ),
    ).toBeGreaterThanOrEqual(0.04);
    // ...but the floor only applies to videos actually in the watch window.
    expect(watchedRepeatPenalty("neverWatched", last, now)).toBe(0);
  });

  it("scoreCandidateDetail score matches scoreCandidate", () => {
    const video = {
      videoId: "v",
      channelId: "UC1",
      title: "Hello world",
      viewCount: 100,
      publishedText: "1 day ago",
    };
    const signals = emptySignals({
      channelWeights: new Map([["UC1", 3]]),
      totalWatches: 20,
    });
    const corpus = buildTfidfModel(["hello", "world"]);
    const ctx = { recentCoverageByChannel: new Map([["UC1", 0.5]]) };
    const d = scoreCandidateDetail(video, signals, corpus, 3, ctx);
    const s = scoreCandidate(video, signals, corpus, 3, ctx);
    expect(d.score).toBeCloseTo(s, 12);
    const sum =
      d.breakdown.components.titleSimilarity +
      d.breakdown.components.channelAffinity +
      d.breakdown.components.popularity +
      d.breakdown.components.freshness +
      d.breakdown.components.repeatPenalty +
      d.breakdown.components.dislikePenalty +
      d.breakdown.components.formatBias +
      d.breakdown.components.explore +
      d.breakdown.components.shareFromChannel +
      d.breakdown.components.catalogCoverage +
      d.breakdown.components.recentChannelBoost;
    expect(sum).toBeCloseTo(d.score, 12);
  });

  it("prefers long-form over shorts when other signals match", () => {
    const base = {
      videoId: "x",
      channelId: "UCsame",
      title: "Topic",
      viewCount: 1000,
      publishedText: "1 day ago",
    };
    const signals = emptySignals({
      channelWeights: new Map([["UCsame", 5]]),
    });
    const corpus = buildTfidfModel(["topic deep dive"]);
    const shortScore = scoreCandidate(
      { ...base, title: "Topic #shorts", durationSeconds: 30 },
      signals,
      corpus,
      5,
    );
    const longScore = scoreCandidate(
      { ...base, title: "Topic deep dive", durationSeconds: 600 },
      signals,
      corpus,
      5,
    );
    expect(longScore).toBeGreaterThan(shortScore);
  });

  it("boosts channels that dominate distinct watch share and recent upload coverage", () => {
    const video = {
      videoId: "newVid",
      channelId: "UCfan",
      title: "Deadlock patch notes",
      viewCount: 500,
      publishedText: "1 day ago",
    };
    const baseSignals = emptySignals({
      channelWeights: new Map([["UCfan", 2]]),
      distinctWatchesByChannel: new Map([["UCfan", 8]]),
      totalDistinctVideosWatched: 10,
      watchedVideoLastSeen: new Map(),
    });
    const corpus = buildTfidfModel(["deadlock gameplay", "deadlock guide"]);
    const low = scoreCandidate(video, baseSignals, corpus, 2, {
      recentCoverageByChannel: new Map([["UCfan", 0.1]]),
    });
    const high = scoreCandidate(video, baseSignals, corpus, 2, {
      recentCoverageByChannel: new Map([["UCfan", 0.9]]),
    });
    expect(high).toBeGreaterThan(low);
    const lowShare = scoreCandidate(
      { ...video, channelId: "UCother" },
      baseSignals,
      corpus,
      2,
      { recentCoverageByChannel: new Map() },
    );
    const fanShare = scoreCandidate(video, baseSignals, corpus, 2, {
      recentCoverageByChannel: new Map(),
    });
    expect(fanShare).toBeGreaterThan(lowShare);
  });

  it("damps catalog coverage for channels with few distinct watches", () => {
    const video = {
      videoId: "v",
      channelId: "UCsmall",
      title: "Topic",
      viewCount: 100,
      publishedText: "1 day ago",
    };
    const ctx = { recentCoverageByChannel: new Map([["UCsmall", 0.8]]) };
    const corpus = buildTfidfModel(["other topic entirely"]);
    const oneWatch = scoreCandidateDetail(
      video,
      emptySignals({
        channelWeights: new Map([["UCsmall", 1]]),
        distinctWatchesByChannel: new Map([["UCsmall", 1]]),
        totalDistinctVideosWatched: 50,
      }),
      corpus,
      1,
      ctx,
    );
    const manyWatches = scoreCandidateDetail(
      video,
      emptySignals({
        channelWeights: new Map([["UCsmall", 1]]),
        distinctWatchesByChannel: new Map([["UCsmall", 4]]),
        totalDistinctVideosWatched: 50,
      }),
      corpus,
      1,
      ctx,
    );
    // One distinct watch only earns a quarter of the saturated coverage credit.
    expect(oneWatch.breakdown.components.catalogCoverage).toBeCloseTo(
      manyWatches.breakdown.components.catalogCoverage / 4,
      10,
    );
    expect(oneWatch.breakdown.inputs.catalogCoverageDamping).toBeCloseTo(
      0.25,
      10,
    );
  });

  it("explore bonus is deterministic per seed and zero without one", () => {
    const video = {
      videoId: "v1",
      title: "Topic",
      viewCount: 100,
      publishedText: "1 day ago",
    };
    const signals = emptySignals({ totalWatches: 20 });
    const corpus = buildTfidfModel(["unrelated corpus"]);
    const seeded = {
      recentCoverageByChannel: new Map<string, number>(),
      exploreSeed: "7:20000",
    };
    const a = scoreCandidateDetail(video, signals, corpus, 1, seeded);
    const b = scoreCandidateDetail(video, signals, corpus, 1, seeded);
    expect(a.score).toBe(b.score);
    expect(a.breakdown.components.explore).toBe(b.breakdown.components.explore);
    const otherVideo = scoreCandidateDetail(
      { ...video, videoId: "v2" },
      signals,
      corpus,
      1,
      seeded,
    );
    expect(otherVideo.breakdown.components.explore).not.toBe(
      a.breakdown.components.explore,
    );
    const unseeded = scoreCandidateDetail(video, signals, corpus, 1, {
      recentCoverageByChannel: new Map(),
    });
    expect(unseeded.breakdown.components.explore).toBe(0);
  });

  describe("keepCandidateForTrendingTail", () => {
    const taste = buildTfidfModel([
      "rust async runtime tokio",
      "rust ownership and borrowing",
    ]);

    it("keeps everything during cold start", () => {
      expect(
        keepCandidateForTrendingTail(
          { videoId: "v", title: "totally unrelated regional hit" },
          emptySignals({ totalWatches: 5 }),
          taste,
          new Set(),
        ),
      ).toBe(true);
    });

    it("rejects off-taste trending rows once history is established", () => {
      expect(
        keepCandidateForTrendingTail(
          { videoId: "v", channelId: "UCnew", title: "pasta carbonara recipe" },
          emptySignals({ totalWatches: 20 }),
          taste,
          new Set(),
        ),
      ).toBe(false);
    });

    it("keeps on-taste rows and watched-channel rows", () => {
      const signals = emptySignals({
        totalWatches: 20,
        channelWeights: new Map([["UCfan", 5]]),
      });
      expect(
        keepCandidateForTrendingTail(
          { videoId: "v", title: "rust async runtime explained" },
          signals,
          taste,
          new Set(),
        ),
      ).toBe(true);
      expect(
        keepCandidateForTrendingTail(
          { videoId: "v", channelId: "UCfan", title: "unrelated title" },
          signals,
          taste,
          new Set(),
        ),
      ).toBe(true);
    });

    it("bypasses the gate for interest channels", () => {
      expect(
        keepCandidateForTrendingTail(
          { videoId: "v", channelId: "UCliked", title: "unrelated title" },
          emptySignals({ totalWatches: 30 }),
          taste,
          new Set(["UCliked"]),
        ),
      ).toBe(true);
    });
  });

  describe("keywordDiscoveryScorePenalty", () => {
    const interestChannelIds = new Set<string>();
    // Mirror production: many distinct taste keywords folded into the corpus 3×,
    // so a stuffed title can match enough distinct terms to trip the spam gate.
    const keywords = [
      "rock",
      "jazz",
      "blues",
      "metal",
      "indie",
      "folk",
      "music",
      "movies",
    ];
    const corpus = keywords.flatMap((k) => [k, k, k]);
    const taste = buildTfidfModel(corpus, { groups: [corpus] });

    it("does not touch non-keyword sources", () => {
      expect(
        keywordDiscoveryScorePenalty(
          { videoId: "v", title: "music compilation" },
          emptySignals(),
          taste,
          "history_channel:UC1",
          interestChannelIds,
        ),
      ).toBe(0);
    });

    it("discounts an unvetted keyword candidate from an unknown channel", () => {
      const penalty = keywordDiscoveryScorePenalty(
        { videoId: "v", channelId: "UCspam", title: "live rock concert" },
        emptySignals(),
        taste,
        "keyword_search:rock",
        interestChannelIds,
      );
      expect(penalty).toBeGreaterThan(0);
    });

    it("flags keyword-stuffed compilations as spam but spares focused titles", () => {
      const stuffed = isUnvettedKeywordSpam(
        {
          videoId: "v",
          channelId: "UCspam",
          title: "rock jazz blues metal indie folk music compilation",
        },
        emptySignals(),
        taste,
        "keyword_search:music",
        interestChannelIds,
      );
      const focused = isUnvettedKeywordSpam(
        { videoId: "v", channelId: "UCspam", title: "live rock concert" },
        emptySignals(),
        taste,
        "keyword_search:rock",
        interestChannelIds,
      );
      expect(stuffed).toBe(true);
      expect(focused).toBe(false);
    });

    it("never flags a non-keyword source as spam", () => {
      expect(
        isUnvettedKeywordSpam(
          {
            videoId: "v",
            title: "rock jazz blues metal indie folk music movies",
          },
          emptySignals(),
          taste,
          "history_channel:UC1",
          interestChannelIds,
        ),
      ).toBe(false);
    });

    it("trusts a keyword hit from a channel the user already watches", () => {
      const signals = emptySignals({
        channelWeights: new Map([["UCfan", 5]]),
      });
      const args = [
        {
          videoId: "v",
          channelId: "UCfan",
          title: "rock jazz blues metal indie folk music",
        },
        signals,
        taste,
        "keyword_search:music",
        new Set(["UCfan"]),
      ] as const;
      expect(keywordDiscoveryScorePenalty(...args)).toBe(0);
      expect(isUnvettedKeywordSpam(...args)).toBe(false);
    });
  });
});
