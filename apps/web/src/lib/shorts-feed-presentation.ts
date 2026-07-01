import { diversifyVideosByChannel } from "@/lib/video-channel-diversity";
import type { UnifiedVideo } from "@/server/services/proxy.types";

/** Max shorts per channel in a single feed page (home shelf and /shorts). */
export const SHORTS_FEED_MAX_PER_CHANNEL = 2;

/**
 * Interleaves channels then caps length — shared by the shorts tRPC feed so home
 * and /shorts use the same presentation rules.
 */
export function prepareShortsFeedVideos(
  videos: readonly UnifiedVideo[],
  limit: number,
): UnifiedVideo[] {
  if (limit < 1) return [];
  return diversifyVideosByChannel(videos, SHORTS_FEED_MAX_PER_CHANNEL).slice(
    0,
    limit,
  );
}
