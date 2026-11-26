import type { VideoPlayerPayload } from "@/components/player/player-payload";
import type { VideoDetail } from "@/server/catalog/types";

/** The player's payload for a video page; null when it cannot be played. */
export function playerPayloadFromDetail(
  detail: VideoDetail,
): VideoPlayerPayload | null {
  const p = detail.playback;
  if (!p) return null;
  const streaming = detail.isLive === true || detail.isPostLiveDvr === true;
  return {
    mode: "hls",
    src: p.hls,
    dash: streaming ? null : p.dash,
    ...(detail.isPostLiveDvr ? { dvr: true } : {}),
  };
}

/** Small enough for hover and scrub previews, and decodable everywhere. */
const PREVIEW_QUERY = "&maxHeight=360&family=avc";

/** A low-resolution HLS stream for card hover and scrub previews (VOD only). */
export function previewStreamFromDetail(detail: VideoDetail): string | null {
  const p = detail.playback;
  if (!p || detail.isLive || detail.isPostLiveDvr || detail.isUpcoming)
    return null;
  return `${p.hls}${PREVIEW_QUERY}`;
}
