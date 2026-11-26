import type { UnifiedVideo } from "@/server/catalog/types";

/** YouTube Shorts max length, for rows that do not say whether they are one. */
export const MAX_SHORT_DURATION_SECONDS = 60;

/** `0`/`-1` mean the length is unknown, not "zero seconds". */
export function hasKnownPositiveDuration(
  seconds: number | undefined,
): seconds is number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0;
}

/**
 * Whether a row is a Short. Rows from the gateway say so (YouTube lists Shorts
 * with their own renderer), and that answer is final. Only rows without it —
 * channel RSS entries — fall back to the length, then to "#shorts" in the
 * title, an SEO convention and a poor signal (4 of 20 tagged search results
 * ran 8-27 minutes).
 */
export function isStrictShortVideo(video: UnifiedVideo): boolean {
  if (video.isLive || video.isUpcoming) return false;
  if (typeof video.isShort === "boolean") return video.isShort;
  const d = video.durationSeconds;
  if (hasKnownPositiveDuration(d)) return d <= MAX_SHORT_DURATION_SECONDS;
  return video.title.toLowerCase().includes("#shorts");
}

/** The Shorts on a page. */
export function filterShortsFeedVideos(videos: UnifiedVideo[]): UnifiedVideo[] {
  return videos.filter(isStrictShortVideo);
}
