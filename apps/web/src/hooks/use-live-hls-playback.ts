"use client";

import type Hls from "hls.js";
import { useEffect, useRef } from "react";
import {
  buildHlsSameOriginConfig,
  installSameOriginMediaFetchGuard,
} from "@/lib/hls-same-origin";

/**
 * Attach hls.js with same-origin segment proxying. Used for live streams where
 * Firefox may pick native HLS (bypassing Vidstack's hls.js provider) and then
 * fetch googlevideo segments without our loaders.
 */
export function useLiveHlsPlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  src: string,
  streamKey: string,
  onFatalError?: () => void,
): void {
  const hlsRef = useRef<Hls | null>(null);
  // Held in a ref: a new error-callback identity (parent re-render) must not
  // tear down and rebuild the Hls instance mid-broadcast.
  const onFatalErrorRef = useRef(onFatalError);
  onFatalErrorRef.current = onFatalError;

  // biome-ignore lint/correctness/useExhaustiveDependencies: streamKey forces a fresh hls.js instance when the player swaps streams without changing the URL.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let cancelled = false;
    let hls: Hls | null = null;
    const releaseFetchGuard = installSameOriginMediaFetchGuard();

    void (async () => {
      const { default: HlsCtor } = await import("hls.js");
      if (cancelled || !videoRef.current) return;

      if (!HlsCtor.isSupported()) {
        video.src = src;
        return;
      }

      const sameOrigin = buildHlsSameOriginConfig();
      hls = new HlsCtor({
        lowLatencyMode: true,
        backBufferLength: 8,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        renderTextTracksNatively: false,
        loader: sameOrigin.loader,
        xhrSetup: sameOrigin.xhrSetup,
        fetchSetup: sameOrigin.fetchSetup,
      });
      hlsRef.current = hls;

      hls.on(HlsCtor.Events.ERROR, (_event, data) => {
        if (data.fatal) onFatalErrorRef.current?.();
      });

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
