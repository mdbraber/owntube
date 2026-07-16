"use client";

import type Hls from "hls.js";
import { useEffect, useRef } from "react";
import {
  buildHlsSameOriginConfig,
  installSameOriginMediaFetchGuard,
} from "@/lib/hls-same-origin";

/**
 * Play our server-generated VOD HLS on a plain `<video>`.
 *
 * On Safari/iOS we set `video.src` directly so playback is **native** —
 * hardware-decoded, no MSE. This is the whole point: MSE engines (dash.js,
 * hls.js-on-ManagedMediaSource) stall the video track on iOS while audio keeps
 * playing. Everywhere else we use hls.js. Segments are already same-origin
 * (`/invidious/videoplayback`), so no cross-origin proxying is needed.
 */
export function useHlsVodPlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string,
  streamKey: string,
  startAtSeconds?: number,
  autoPlay = false,
  onFatalError?: () => void,
): void {
  const hlsRef = useRef<Hls | null>(null);
  const onFatalErrorRef = useRef(onFatalError);
  onFatalErrorRef.current = onFatalError;
  const startAtRef = useRef(startAtSeconds);
  startAtRef.current = startAtSeconds;
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;

  // biome-ignore lint/correctness/useExhaustiveDependencies: streamKey forces a fresh instance when the source swaps without changing the URL.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const applyStartAndPlay = () => {
      const start = startAtRef.current;
      if (typeof start === "number" && Number.isFinite(start) && start > 0) {
        try {
          video.currentTime = start;
        } catch {
          /* not seekable yet */
        }
      }
      if (autoPlayRef.current) void video.play().catch(() => {});
    };

    // Native HLS (Safari/iOS) is normally the robust, hardware-decoded path —
    // BUT the macOS media stack (a real Mac, or an iPad in "Request Desktop
    // Website" mode — both report a real, unmanaged `window.MediaSource`)
    // rejects our byte-range fMP4 VOD manifest natively with
    // MEDIA_ERR_SRC_NOT_SUPPORTED. hls.js parses the manifest itself and plays
    // it over real MSE there. So we only take the native path when the browser
    // has NO real MediaSource — i.e. iPhone/iPad-class WebKit that exposes only
    // ManagedMediaSource (where hls.js would fall back to MMS and stall the
    // video track, and where native HLS works). See use-dash-playback for the
    // sibling MMS/MSE notes.
    const hasRealMediaSource =
      typeof window !== "undefined" && "MediaSource" in window;
    const canNative =
      video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
      video.canPlayType("application/x-mpegURL") !== "";
    if (canNative && !hasRealMediaSource) {
      const onLoaded = () => applyStartAndPlay();
      const onError = () => onFatalErrorRef.current?.();
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError);
      video.src = src;
      video.load();
      return () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
        video.removeAttribute("src");
        video.load();
      };
    }

    // hls.js: non-Safari, and Safari on the macOS media stack (real Mac /
    // desktop-mode iPad) where native HLS rejects the manifest. Same-origin
    // config is a harmless no-op for our already-same-origin segments and still
    // proxies any stray CDN URL.
    let cancelled = false;
    let hls: Hls | null = null;
    const releaseFetchGuard = installSameOriginMediaFetchGuard();
    void (async () => {
      const { default: HlsCtor } = await import("hls.js");
      if (cancelled || !videoRef.current) return;
      if (!HlsCtor.isSupported()) {
        video.src = src;
        video.addEventListener("loadedmetadata", applyStartAndPlay, {
          once: true,
        });
        return;
      }
      hls = new HlsCtor(buildHlsSameOriginConfig());
      hlsRef.current = hls;
      hls.on(HlsCtor.Events.ERROR, (_e, data) => {
        if (data.fatal) onFatalErrorRef.current?.();
      });
      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => applyStartAndPlay());
      hls.loadSource(src);
      hls.attachMedia(video);
    })();

    return () => {
      cancelled = true;
      releaseFetchGuard();
      hls?.destroy();
      hlsRef.current = null;
      const v = videoRef.current;
      if (v) {
        v.removeAttribute("src");
        v.load();
      }
    };
  }, [videoRef, src, streamKey]);
}
