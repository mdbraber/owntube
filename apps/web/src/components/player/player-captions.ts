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

/** Strip WebVTT markup (tags/timestamps) and decode the entities we see. */
function stripMarkup(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

/** A run of caption text and the playback time (s) at which it appears. */
type TimedSegment = { at: number; text: string };

const TS_TAG = /<(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\.(\d{3})>/g;

/**
 * Split a cue into timed segments using its inline `<HH:MM:SS.mmm>` word
 * markers (YouTube ASR "paint-on" timing). Text before the first marker shows
 * at the cue's own start; each marker sets when the following run appears. Cues
 * without markers (manual subtitles) yield a single segment at `startTime`, so
 * they simply show in full while active — matching normal subtitle behavior.
 */
function parseTimedSegments(cue: VTTCue): TimedSegment[] {
  const raw = cue.text ?? "";
  const segments: TimedSegment[] = [];
  let at = cue.startTime;
  let lastIndex = 0;
  TS_TAG.lastIndex = 0;
  for (let m = TS_TAG.exec(raw); m; m = TS_TAG.exec(raw)) {
    segments.push({ at, text: stripMarkup(raw.slice(lastIndex, m.index)) });
    const h = m[1] ? Number(m[1]) : 0;
    at = h * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    lastIndex = TS_TAG.lastIndex;
  }
  segments.push({ at, text: stripMarkup(raw.slice(lastIndex)) });
  return segments;
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

    // YouTube-derived VTT overlaps roll-up cues, and each real cue carries the
    // line's per-word timing. Pick the one live cue that owns the current words
    // (latest start; longest when tied — the tiny 10ms echo cues lose), then
    // reveal its words as playback reaches each timestamp so captions stream in
    // like YouTube instead of popping a whole line at once.
    let segments: TimedSegment[] = [];
    const pickSegments = () => {
      const cues = findTrack()?.activeCues;
      let best: VTTCue | null = null;
      for (let i = 0; i < (cues?.length ?? 0); i++) {
        const cue = cues?.[i] as VTTCue;
        const better =
          !best ||
          cue.startTime > best.startTime ||
          (cue.startTime === best.startTime &&
            cue.endTime - cue.startTime > best.endTime - best.startTime);
        if (better) best = cue;
      }
      segments = best ? parseTimedSegments(best) : [];
    };

    let raf = 0;
    let shown: string | null = null;
    const reveal = () => {
      const now = video.currentTime;
      let out = "";
      for (const seg of segments) if (seg.at <= now + 0.05) out += seg.text;
      const text = out.replace(/\s+/g, " ").trim();
      const next = text.length > 0 ? text : null;
      if (next !== shown) {
        shown = next;
        setActiveText(next);
      }
    };
    const loop = () => {
      reveal();
      raf = requestAnimationFrame(loop);
    };

    const onCueChange = () => {
      pickSegments();
      reveal();
    };

    onCueChange();
    loop();
    const tt = findTrack();
    tt?.addEventListener("cuechange", onCueChange);
    video.addEventListener("loadedmetadata", onCueChange);
    // hls.js can swap the track object on attach; re-read when the list changes.
    video.textTracks.addEventListener?.("change", onCueChange);
    return () => {
      cancelAnimationFrame(raf);
      tt?.removeEventListener("cuechange", onCueChange);
      video.removeEventListener("loadedmetadata", onCueChange);
      video.textTracks.removeEventListener?.("change", onCueChange);
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
