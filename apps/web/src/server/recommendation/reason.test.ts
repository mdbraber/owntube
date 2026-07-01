import { describe, expect, it } from "vitest";
import { deriveRecommendationReason } from "@/server/recommendation/reason";
import type { RecommendationScoreBreakdown } from "@/server/recommendation/scoring";
import type { TfidfModel } from "@/server/recommendation/tfidf";
import type { UnifiedVideo } from "@/server/services/proxy.types";

function makeBreakdown(
  components: Partial<RecommendationScoreBreakdown["components"]>,
  inputs: Partial<RecommendationScoreBreakdown["inputs"]> = {},
): RecommendationScoreBreakdown {
  return {
    components: {
      titleSimilarity: 0,
      channelAffinity: 0,
      popularity: 0,
      freshness: 0,
      repeatPenalty: 0,
      dislikePenalty: 0,
      formatBias: 0,
      explore: 0,
      shareFromChannel: 0,
      catalogCoverage: 0,
      recentChannelBoost: 0,
      ...components,
    },
    inputs: {
      titleSimilarity: 0,
      channelAffinityNorm: 0,
      popularityNorm: 0,
      publicationFreshness: 0,
      repeatPenaltyRaw: 0,
      dislikeSimilarityRaw: 0,
      isShort: false,
      exploreRaw: 0,
      distinctVideosOnChannel: 0,
      distinctShareFromChannel: 0,
      recentPageCoverageOnChannel: 0,
      catalogCoverageDamping: 0,
      recentChannelBoostRaw: 0,
      ...inputs,
    },
  };
}

const TASTE_MODEL: TfidfModel = {
  isEmpty: false,
  similarity: () => 0.2,
  explain: () => ["physics", "space"],
};

const video: UnifiedVideo = {
  videoId: "abc123",
  title: "Physics of space travel",
  channelName: "Veritasium",
  channelId: "UC-chan",
};

describe("deriveRecommendationReason", () => {
  it("returns subscription when the candidate came from a subscribed channel", () => {
    // ShortCircuit case: subscription provenance must win over the title match,
    // even though being subscribed is invisible to the history-only affinity.
    const reason = deriveRecommendationReason(
      makeBreakdown({ titleSimilarity: 0.4, channelAffinity: 0 }),
      video,
      TASTE_MODEL,
      "subscription:UC-chan",
    );
    expect(reason).toEqual({
      kind: "subscription",
      channelName: "Veritasium",
    });
  });

  it("returns channel when the candidate came from a watched channel", () => {
    const reason = deriveRecommendationReason(
      makeBreakdown({ titleSimilarity: 0.4 }),
      video,
      TASTE_MODEL,
      "history_channel:UC-chan",
    );
    expect(reason).toEqual({ kind: "channel", channelName: "Veritasium" });
  });

  it("returns channel when channel affinity dominates", () => {
    const reason = deriveRecommendationReason(
      makeBreakdown({ channelAffinity: 0.1, titleSimilarity: 0.02 }),
      video,
      TASTE_MODEL,
    );
    expect(reason).toEqual({ kind: "channel", channelName: "Veritasium" });
  });

  it("prefers channel for a followed channel even when the title matches a topic", () => {
    // The user watches most of this channel, so the high weighted title score
    // must not override "because you watch …".
    const reason = deriveRecommendationReason(
      makeBreakdown(
        { titleSimilarity: 0.4, channelAffinity: 0.12 },
        { channelAffinityNorm: 0.8 },
      ),
      video,
      TASTE_MODEL,
    );
    expect(reason).toEqual({ kind: "channel", channelName: "Veritasium" });
  });

  it("labels generic trending filler as trending", () => {
    const reason = deriveRecommendationReason(
      makeBreakdown({ freshness: 0.16, popularity: 0.08 }),
      video,
      TASTE_MODEL,
      "trending",
    );
    expect(reason).toEqual({ kind: "trending" });
  });

  it("does not claim 'you watch' for a trending channel's uploads", () => {
    // trending_channel_head is a regional-trending channel, not a watched one,
    // and a coincidental title match must not be presented as a topic either.
    const reason = deriveRecommendationReason(
      makeBreakdown({ titleSimilarity: 0.3, channelAffinity: 0.05 }),
      video,
      TASTE_MODEL,
      "trending_channel_head:UC-other",
    );
    expect(reason).toEqual({ kind: "trending" });
  });

  it("still credits a trending channel the user actually watches", () => {
    const reason = deriveRecommendationReason(
      makeBreakdown({ titleSimilarity: 0.1 }, { channelAffinityNorm: 0.6 }),
      video,
      TASTE_MODEL,
      "trending_channel_head:UC-chan",
    );
    expect(reason).toEqual({ kind: "channel", channelName: "Veritasium" });
  });

  it("prefers channel when watched there very recently", () => {
    const reason = deriveRecommendationReason(
      makeBreakdown(
        { titleSimilarity: 0.4 },
        { channelAffinityNorm: 0.1, recentChannelBoostRaw: 0.7 },
      ),
      video,
      TASTE_MODEL,
    );
    expect(reason).toEqual({ kind: "channel", channelName: "Veritasium" });
  });

  it("returns topic with matched terms when title similarity dominates", () => {
    const reason = deriveRecommendationReason(
      makeBreakdown({ titleSimilarity: 0.3, channelAffinity: 0.01 }),
      video,
      TASTE_MODEL,
    );
    expect(reason).toEqual({ kind: "topic", terms: ["physics", "space"] });
  });

  it("falls back to topic without terms when none overlap", () => {
    const reason = deriveRecommendationReason(
      makeBreakdown({ titleSimilarity: 0.3 }),
      video,
      { isEmpty: false, similarity: () => 0, explain: () => [] },
    );
    expect(reason).toEqual({ kind: "topic" });
  });

  it("returns related for related-expansion rows when channel/topic are weak", () => {
    const reason = deriveRecommendationReason(
      makeBreakdown({ titleSimilarity: 0.005, channelAffinity: 0.005 }),
      video,
      TASTE_MODEL,
      "related:seedVideo",
    );
    expect(reason).toEqual({ kind: "related" });
  });

  it("returns undefined when only freshness/popularity contribute", () => {
    const reason = deriveRecommendationReason(
      makeBreakdown({ freshness: 0.16, popularity: 0.08 }),
      video,
      TASTE_MODEL,
    );
    expect(reason).toBeUndefined();
  });

  it("prefers topic over channel when the channel name is unknown", () => {
    const reason = deriveRecommendationReason(
      makeBreakdown({ channelAffinity: 0.1, titleSimilarity: 0.05 }),
      { ...video, channelName: undefined },
      TASTE_MODEL,
    );
    expect(reason).toEqual({ kind: "topic", terms: ["physics", "space"] });
  });
});
