"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Session-shared mute state for the shorts feed. Shorts start muted so they can
 * autoplay (browsers block unmuted autoplay), but once the viewer unmutes one
 * short every following short stays unmuted — by then they've interacted, so
 * unmuted autoplay is allowed. Deliberately in-memory: it resets to muted on a
 * fresh page load, matching how each visit to the feed begins silent.
 */
let muted = true;
const listeners = new Set<() => void>();

export function getShortsMuted(): boolean {
  return muted;
}

export function setShortsMuted(next: boolean): void {
  if (next === muted) return;
  muted = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive read of the shared shorts mute state. */
export function useShortsMuted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => muted,
    () => true,
  );
}

/** Write the active short's live mute state back to the shared pref. */
export function useShortsAudioPersist(
  adapterMuted: boolean,
  shortsMode: boolean,
): void {
  useEffect(() => {
    if (!shortsMode) return;
    setShortsMuted(adapterMuted);
  }, [adapterMuted, shortsMode]);
}

/**
 * Shorts always autoplay MUTED (the only thing every browser allows without a
 * gesture — unmuted autoplay on a fresh element is blocked even after the viewer
 * has interacted). This applies the viewer's real preference once the video is
 * actually playing: if they've turned sound on, unmute it then (allowed on a
 * playing element), and keep it in sync if they toggle mid-play.
 */
export function useShortsUnmuteAfterPlay(
  videoRef: { current: HTMLVideoElement | null },
  shortsMode: boolean,
  streamKey: string,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: streamKey re-arms for a new source.
  useEffect(() => {
    if (!shortsMode) return;
    const el = videoRef.current;
    if (!el) return;
    const apply = () => {
      el.muted = getShortsMuted();
    };
    if (!el.paused) apply();
    el.addEventListener("playing", apply);
    const unsubscribe = subscribe(() => {
      if (!el.paused) apply();
    });
    return () => {
      el.removeEventListener("playing", apply);
      unsubscribe();
    };
  }, [shortsMode, streamKey, videoRef]);
}
