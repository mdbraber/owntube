"use client";

import { useCallback, useEffect, useState } from "react";
import type { CaptionTrack } from "@/components/player/player-payload";
import {
  readCaptionLangPref,
  writeCaptionLangPref,
} from "@/lib/player-media-prefs";

export type CaptionModel =
  | { kind: "none" }
  | {
      kind: "tracks";
      items: { label: string; languageCode: string }[];
      /** Index into `items`, or `null` when captions are off. */
      activeIndex: number | null;
      /** Select a track (or `null` for off); persists the language choice. */
      setActive: (index: number | null) => void;
    };

/**
 * Drive sidecar `<track>` captions on a plain `<video>`. The block renders the
 * `<track>` children from `tracks`; this hook owns which one is showing, keeps
 * the native `TextTrack` modes in sync (re-applying after `loadedmetadata` and
 * whenever hls.js mutates the track list), and remembers the chosen language
 * across videos.
 *
 * We match `TextTrack`s to our tracks by `label` so we never touch any
 * in-manifest tracks hls.js might add. Pass `enabled: false` on the iOS
 * native-controls path so Safari's own caption UI stays in charge.
 */
export function usePlayerCaptions(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  tracks: CaptionTrack[],
  reactKey: string,
  enabled = true,
): CaptionModel {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // On a new source, restore the remembered language when it's available.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey re-resolves the remembered track for a new video.
  useEffect(() => {
    const lang = readCaptionLangPref();
    if (!lang) {
      setActiveIndex(null);
      return;
    }
    const idx = tracks.findIndex((t) => t.languageCode === lang);
    setActiveIndex(idx >= 0 ? idx : null);
  }, [reactKey, tracks]);

  // Reflect the selected index onto the native TextTrack modes. Re-applied on
  // metadata load and on any track-list mutation (hls.js adds/removes tracks on
  // attach and level switches, which can silently reset our modes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey rebinds after the media element remounts.
  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    if (!video) return;
    const wantLabel =
      activeIndex !== null ? (tracks[activeIndex]?.label ?? null) : null;
    const ourLabels = new Set(tracks.map((t) => t.label));

    const apply = () => {
      const list = video.textTracks;
      for (let i = 0; i < list.length; i++) {
        const tt = list[i];
        if (!tt || !ourLabels.has(tt.label)) continue;
        const mode: TextTrackMode =
          wantLabel !== null && tt.label === wantLabel ? "showing" : "disabled";
        if (tt.mode !== mode) tt.mode = mode;
      }
    };

    apply();
    video.addEventListener("loadedmetadata", apply);
    video.textTracks.addEventListener?.("addtrack", apply);
    video.textTracks.addEventListener?.("change", apply);
    return () => {
      video.removeEventListener("loadedmetadata", apply);
      video.textTracks.removeEventListener?.("addtrack", apply);
      video.textTracks.removeEventListener?.("change", apply);
    };
  }, [videoRef, tracks, activeIndex, enabled, reactKey]);

  const setActive = useCallback(
    (index: number | null) => {
      setActiveIndex(index);
      const lang =
        index !== null ? (tracks[index]?.languageCode ?? null) : null;
      writeCaptionLangPref(lang);
    },
    [tracks],
  );

  if (tracks.length === 0) return { kind: "none" };
  return {
    kind: "tracks",
    items: tracks.map((t) => ({
      label: t.label,
      languageCode: t.languageCode,
    })),
    activeIndex,
    setActive,
  };
}
