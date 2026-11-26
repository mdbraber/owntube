import type { VideoDetail } from "@web/server/catalog/types";
import { Platform } from "react-native";
import { baseUrl } from "@/lib/config";

/**
 * The gateway manifest a single-source player should open for a video, or
 * undefined when it cannot be played. ExoPlayer (Android TV) takes DASH for
 * VOD; AVPlayer (tvOS), live and post-live DVR take HLS.
 */
export function manifestUrl(
  detail: VideoDetail,
  opts: { maxHeight?: number } = {},
): string | undefined {
  const p = detail.playback;
  if (!p) return undefined;
  const streaming = detail.isLive === true || detail.isPostLiveDvr === true;
  if (streaming || Platform.OS === "ios") return `${baseUrl()}${p.hls}`;
  const cap = opts.maxHeight ? `&maxHeight=${opts.maxHeight}` : "";
  return `${baseUrl()}${p.dash}&family=vp9,avc${cap}`;
}
