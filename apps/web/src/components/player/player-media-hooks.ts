"use client";

import { type RefObject, useEffect, useRef } from "react";
import type { PlayerAdapter } from "@/components/player/player-types";
import { readPlayerMediaPrefs } from "@/lib/player-media-prefs";

export function useReportVideoIntrinsics(
  videoRef: RefObject<HTMLVideoElement | null>,
  onVideoIntrinsics?: (width: number, height: number) => void,
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onVideoIntrinsics) return;
    const report = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onVideoIntrinsics(video.videoWidth, video.videoHeight);
      }
    };
    video.addEventListener("loadedmetadata", report);
    report();
    return () => video.removeEventListener("loadedmetadata", report);
  }, [videoRef, onVideoIntrinsics]);
}

/** Once when mini player is ready: volume + mute from user prefs (via adapter, not video.muted). */
export function useMiniPlayerMediaBootstrap(
  adapter: PlayerAdapter,
  miniMode: boolean,
  shortsMode: boolean,
  restoredVolume?: number,
  restoredMuted?: boolean,
) {
  const appliedRef = useRef(false);
  useEffect(() => {
    if (!miniMode || shortsMode) return;
    if (!adapter.canPlay || appliedRef.current) return;
    appliedRef.current = true;
    const prefs = readPlayerMediaPrefs();
    const vol =
      typeof restoredVolume === "number" && Number.isFinite(restoredVolume)
        ? restoredVolume
        : prefs.volume;
    adapter.setVolume(vol);
    const muted =
      typeof restoredMuted === "boolean" ? restoredMuted : prefs.muted;
    if (muted !== adapter.muted) adapter.toggleMuted();
  }, [
    adapter,
    adapter.canPlay,
    miniMode,
    restoredVolume,
    restoredMuted,
    shortsMode,
  ]);
}

/** Autoplay for Shorts / mini on native <video> (muxed + split). */
export function useShortsNativeAutoplay(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  streamKey: string,
  muteForAutoplayPolicy = false,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: streamKey retriggers autoplay for a remounted native media source.
  useEffect(() => {
    if (!enabled) return;
    const el = videoRef.current;
    if (!el) return;

    const tryPlay = () => {
      if (!el.paused) return;
      if (muteForAutoplayPolicy) el.muted = true;
      void el.play().catch(() => {
        /* autoplay policy */
      });
    };

    tryPlay();
    el.addEventListener("loadeddata", tryPlay);
    el.addEventListener("canplay", tryPlay);
    return () => {
      el.removeEventListener("loadeddata", tryPlay);
      el.removeEventListener("canplay", tryPlay);
    };
  }, [enabled, muteForAutoplayPolicy, streamKey, videoRef]);
}
