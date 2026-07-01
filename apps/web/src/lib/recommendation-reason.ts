import type { RecommendationReason } from "@/server/services/proxy.types";

/** English label explaining why a personalized feed row was recommended. */
export function formatRecommendationReason(
  reason: RecommendationReason,
): string {
  switch (reason.kind) {
    case "subscription":
      return reason.channelName
        ? `Because you're subscribed to ${reason.channelName}`
        : "Because you're subscribed to this channel";
    case "channel":
      return reason.channelName
        ? `Because you watch ${reason.channelName}`
        : "From a channel you watch";
    case "topic":
      return reason.terms && reason.terms.length > 0
        ? `Matches topics you watch: ${reason.terms.join(", ")}`
        : "Matches topics you watch";
    case "related":
      return "Related to videos you watched";
    case "trending":
      return "Trending now";
  }
}
