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
      /**
       * Lift the caption line up (above the scrubber) while the player chrome
       * is showing; drop it back to the lower resting position when chrome hides.
       */
      setRaised: (raised: boolean) => void;
    };

/** VTTCue positioning fields not present on the base `TextTrackCue` type. */
type PositionableCue = TextTrackCue & {
  align: string;
  position: number | "auto";
  line: number | "auto";
  snapToLines: boolean;
};

// Caption line as a percentage of video height (top-anchored). The resting
// position sits low; the raised position clears the bottom chrome/scrubber.
const CAPTION_LINE_RESTING = 90;
const CAPTION_LINE_RAISED = 78;

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
  const [raised, setRaised] = useState(false);

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

  // Center each cue horizontally and place it vertically. WebVTT sources often
  // ship cues with `align:start`/`position:0%`, which the browser renders
  // left-aligned; we normalize to center and drive the line off `raised`.
  // Re-applied on new cues (they load async) and whenever `raised` toggles.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey rebinds after the media element remounts.
  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    if (!video) return;
    const wantLabel =
      activeIndex !== null ? (tracks[activeIndex]?.label ?? null) : null;
    if (wantLabel === null) return;

    const findTrack = () => {
      const list = video.textTracks;
      for (let i = 0; i < list.length; i++) {
        const tt = list[i];
        if (tt && tt.label === wantLabel) return tt;
      }
      return null;
    };

    const line = raised ? CAPTION_LINE_RAISED : CAPTION_LINE_RESTING;
    const place = () => {
      const cues = findTrack()?.cues;
      if (!cues) return;
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i] as PositionableCue;
        cue.align = "center";
        cue.position = "auto";
        cue.snapToLines = false;
        cue.line = line;
      }
    };

    place();
    const tt = findTrack();
    tt?.addEventListener("cuechange", place);
    video.addEventListener("loadedmetadata", place);
    return () => {
      tt?.removeEventListener("cuechange", place);
      video.removeEventListener("loadedmetadata", place);
    };
  }, [videoRef, tracks, activeIndex, raised, enabled, reactKey]);

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
    setRaised,
  };
}
