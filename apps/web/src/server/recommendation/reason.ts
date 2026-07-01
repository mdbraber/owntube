import type { RecommendationScoreBreakdown } from "@/server/recommendation/scoring";
import type { TfidfModel } from "@/server/recommendation/tfidf";
import type {
  RecommendationReason,
  UnifiedVideo,
} from "@/server/services/proxy.types";

/**
 * Below this weighted contribution a signal is treated as noise and does not
 * justify an explanation line (avoids "why" labels driven only by freshness or
 * popularity, which are not user-specific).
 */
const MIN_MEANINGFUL_CONTRIBUTION = 0.03;

/**
 * A channel whose normalized affinity reaches this (≈ a third of the user's
 * top channel) is one they clearly follow. "Because you watch X" is then the
 * honest reason even when the title also matches a topic — comparing the raw
 * weighted components would over-favour the title, whose scoring weight (W_TITLE)
 * dwarfs every individual channel weight.
 */
const STRONG_CHANNEL_AFFINITY = 0.3;
/** Watched on this channel very recently (`recentChannelBoostRaw`, ~last 3–4 days). */
const STRONG_CHANNEL_RECENCY = 0.5;

/**
 * Derives a short, user-facing reason for a personalized row. Provenance comes
 * first — `candidateSource` records *why* the candidate entered the pool, which
 * is the most honest explanation (a subscription / followed channel is invisible
 * to the score breakdown's affinity, which is history-only). Only when the source
 * is generic do we fall back to the measured channel affinity / topic match.
 *
 * `candidateSource` values come from the collectors: `subscription:<id>`
 * (subscribed), `history_channel:<id>` (in watch history), `related:<id>`
 * (related to a watched video), `keyword_search:<kw>` (a "Refine
 * recommendations" topic the user configured), and `trending`/
 * `trending_channel_head:<id>` (regional trending — NOT a personal signal).
 */
export function deriveRecommendationReason(
  breakdown: RecommendationScoreBreakdown,
  video: UnifiedVideo,
  tasteModel: TfidfModel,
  candidateSource?: string,
): RecommendationReason | undefined {
  const c = breakdown.components;
  const inputs = breakdown.inputs;
  const hasChannelName = Boolean(video.channelName);
  const source = candidateSource ?? "";
  // A trending channel's uploads (`trending_channel_head:`) are regional
  // trending, not something the user watches — treated like plain trending.
  const isTrendingSource =
    source === "trending" || source.startsWith("trending_channel_head:");
  // The candidate was fetched *because* it matched a user-configured topic, so a
  // topic reason is honest even when the title's measured similarity is marginal.
  const isKeywordSource = source.startsWith("keyword_search:");

  // 1. Provenance: the channel the candidate was collected from because the
  //    user has a relationship with it (subscribed / in watch history).
  if (hasChannelName && source.startsWith("subscription:")) {
    return { kind: "subscription", channelName: video.channelName };
  }
  if (hasChannelName && source.startsWith("history_channel:")) {
    return { kind: "channel", channelName: video.channelName };
  }

  // 2. Measured affinity: a channel watched a lot / recently, even when the
  //    candidate arrived via a generic source (e.g. trending or topic match).
  if (
    hasChannelName &&
    (inputs.channelAffinityNorm >= STRONG_CHANNEL_AFFINITY ||
      inputs.recentChannelBoostRaw >= STRONG_CHANNEL_RECENCY)
  ) {
    return { kind: "channel", channelName: video.channelName };
  }

  // 3. Topic match against the user's taste (not for pure trending filler,
  //    which would otherwise claim a topic from coincidental title tokens).
  const topicScore = Math.max(0, c.titleSimilarity);
  if (
    !isTrendingSource &&
    (isKeywordSource || topicScore >= MIN_MEANINGFUL_CONTRIBUTION)
  ) {
    const terms = tasteModel.explain(video.title, 3);
    return terms.length > 0 ? { kind: "topic", terms } : { kind: "topic" };
  }

  // 4. Weaker but still present channel affinity.
  const channelScore =
    Math.max(0, c.channelAffinity) +
    Math.max(0, c.recentChannelBoost) +
    Math.max(0, c.shareFromChannel) +
    Math.max(0, c.catalogCoverage);
  if (
    hasChannelName &&
    !isTrendingSource &&
    channelScore >= MIN_MEANINGFUL_CONTRIBUTION
  ) {
    return { kind: "channel", channelName: video.channelName };
  }

  if (source.startsWith("related:")) {
    return { kind: "related" };
  }
  // 5. Regional trending filler — labelled honestly rather than left unexplained.
  if (isTrendingSource) {
    return { kind: "trending" };
  }
  return undefined;
}
