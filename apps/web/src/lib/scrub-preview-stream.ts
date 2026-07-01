import {
  type CardPreviewPlayback,
  cardPreviewPlaybackFromDetail,
} from "@/lib/card-preview-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

/** Low-bitrate stream for timeline scrub preview (separate from main playback). */
export function scrubPreviewStreamFromDetail(
  detail: VideoDetail,
  appOrigin: string,
  requestHost: string,
): string | null {
  const playback: CardPreviewPlayback | null = cardPreviewPlaybackFromDetail(
    detail,
    appOrigin,
    requestHost,
  );
  if (!playback) return null;
  if (playback.kind === "muxed" || playback.kind === "hls") return playback.src;
  return playback.videoSrc;
}
