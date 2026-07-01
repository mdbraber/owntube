"use client";

import type { VideoPlayerPayload } from "@/components/player/video-player";
import {
  toProxiedOrDirectPlayback,
  toProxiedOrDirectPoster,
  toProxiedOrDirectVariants,
} from "@/lib/invidious-proxy";
import { buildWatchPlayback } from "@/lib/pick-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

export type ClientWatchPlayback = {
  payload: VideoPlayerPayload | null;
  poster?: string;
  onlyDashOrUnsupported: boolean;
};

/** Build proxied playback for the current browser origin (same idea as the watch page on the server). */
export function buildClientWatchPlayback(
  detail: VideoDetail,
): ClientWatchPlayback {
  if (typeof window === "undefined") {
    return { payload: null, onlyDashOrUnsupported: true };
  }
  const appOrigin = window.location.origin;
  const requestHost = window.location.host;
  const rawPlayback = buildWatchPlayback(detail);
  const onlyDashOrUnsupported =
    rawPlayback.kind === "none" && rawPlayback.onlyDashOrUnsupported;
  const videoPayload =
    rawPlayback.kind === "hls"
      ? {
          mode: "hls" as const,
          src: toProxiedOrDirectPlayback(
            rawPlayback.url,
            appOrigin,
            requestHost,
            detail,
          ),
        }
      : rawPlayback.kind === "progressive"
        ? {
            mode: "progressive" as const,
            variants: toProxiedOrDirectVariants(
              rawPlayback.variants,
              appOrigin,
              requestHost,
              detail,
            ),
          }
        : null;
  const poster = toProxiedOrDirectPoster(
    detail.thumbnailUrl,
    appOrigin,
    requestHost,
    detail,
  );
  return {
    payload: videoPayload,
    poster,
    onlyDashOrUnsupported,
  };
}
