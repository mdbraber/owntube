import {
  type ProxiedPlayableVariant,
  toProxiedOrDirectPlayback,
  toProxiedOrDirectPoster,
  toProxiedOrDirectVariants,
} from "@/lib/invidious-proxy";
import { buildWatchPlayback } from "@/lib/pick-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

export type WatchPlayerPayload =
  | { mode: "hls"; src: string }
  | { mode: "progressive"; variants: ProxiedPlayableVariant[] };

export function buildVideoPlayerPayloadFromDetail(
  detail: VideoDetail,
  appOrigin: string,
  requestHost: string,
  options?: {
    /** iOS Safari: prefer HLS/muxed — split video+audio stalls there. */
    avoidSplitAudioVideo?: boolean;
  },
): {
  payload: WatchPlayerPayload | null;
  poster?: string;
  onlyDashOrUnsupported: boolean;
} {
  const rawPlayback = buildWatchPlayback(detail, {
    shorts: true,
    avoidSplitAudioVideo: options?.avoidSplitAudioVideo,
  });
  const onlyDashOrUnsupported =
    rawPlayback.kind === "none" && rawPlayback.onlyDashOrUnsupported;
  if (rawPlayback.kind === "hls") {
    return {
      payload: {
        mode: "hls",
        src: toProxiedOrDirectPlayback(
          rawPlayback.url,
          appOrigin,
          requestHost,
          detail,
        ),
      },
      poster: toProxiedOrDirectPoster(
        detail.thumbnailUrl,
        appOrigin,
        requestHost,
        detail,
      ),
      onlyDashOrUnsupported,
    };
  }
  if (rawPlayback.kind === "progressive") {
    const variants = toProxiedOrDirectVariants(
      rawPlayback.variants,
      appOrigin,
      requestHost,
      detail,
    );
    return {
      payload: {
        mode: "progressive",
        variants,
      },
      poster: toProxiedOrDirectPoster(
        detail.thumbnailUrl,
        appOrigin,
        requestHost,
        detail,
      ),
      onlyDashOrUnsupported,
    };
  }
  return {
    payload: null,
    poster: toProxiedOrDirectPoster(
      detail.thumbnailUrl,
      appOrigin,
      requestHost,
      detail,
    ),
    onlyDashOrUnsupported,
  };
}
