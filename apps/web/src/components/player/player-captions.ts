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
       * Text of the currently-showing cue(s), or `null` when nothing is on
       * screen. We render this ourselves in a custom overlay (see
       * `CaptionOverlay`) instead of letting the browser draw the native cues,
       * so we control alignment and placement relative to the player chrome.
       */
      activeText: string | null;
    };

/** Strip WebVTT markup/timestamps and decode the handful of entities we see. */
function cueToPlainText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Drive sidecar `<track>` captions on a plain `<video>`. The block renders the
 * `<track>` children from `tracks`; this hook owns which one is active and
 * remembers the chosen language across videos.
 *
 * We keep the active `TextTrack` in `hidden` mode (cues fire events but the
 * browser draws nothing) and surface the current cue text as `activeText`, which
 * the chrome renders in its own overlay — that lets us center the block with
 * left-aligned lines and lift it above the scrubber. We match `TextTrack`s to
 * our tracks by `label` so we never touch any in-manifest tracks hls.js might
 * add. Pass `enabled: false` on the iOS native-controls path so Safari's own
 * caption UI stays in charge.
 */
export function usePlayerCaptions(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  tracks: CaptionTrack[],
  reactKey: string,
  enabled = true,
): CaptionModel {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeText, setActiveText] = useState<string | null>(null);

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
        // `hidden` (not `showing`): cues still fire `cuechange`, but the browser
        // draws nothing — we render the text ourselves in the overlay.
        const mode: TextTrackMode =
          wantLabel !== null && tt.label === wantLabel ? "hidden" : "disabled";
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

  // Mirror the active track's on-screen cues into `activeText`. Cues load async
  // and swap as playback advances, so we re-read on every `cuechange`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey rebinds after the media element remounts.
  useEffect(() => {
    const video = videoRef.current;
    const wantLabel =
      enabled && activeIndex !== null
        ? (tracks[activeIndex]?.label ?? null)
        : null;
    if (!video || wantLabel === null) {
      setActiveText(null);
      return;
    }

    const findTrack = () => {
      const list = video.textTracks;
      for (let i = 0; i < list.length; i++) {
        const tt = list[i];
        if (tt && tt.label === wantLabel) return tt;
      }
      return null;
    };

    const read = () => {
      const cues = findTrack()?.activeCues;
      if (!cues || cues.length === 0) {
        setActiveText(null);
        return;
      }
      const parts: string[] = [];
      for (let i = 0; i < cues.length; i++) {
        const text = cueToPlainText((cues[i] as VTTCue).text ?? "");
        if (text) parts.push(text);
      }
      setActiveText(parts.length > 0 ? parts.join("\n") : null);
    };

    read();
    const tt = findTrack();
    tt?.addEventListener("cuechange", read);
    video.addEventListener("loadedmetadata", read);
    // hls.js can swap the track object on attach; re-read when the list changes.
    video.textTracks.addEventListener?.("change", read);
    return () => {
      tt?.removeEventListener("cuechange", read);
      video.removeEventListener("loadedmetadata", read);
      video.textTracks.removeEventListener?.("change", read);
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
    activeText,
  };
}
