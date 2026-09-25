"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptionTrack } from "@/components/player/player-payload";
import {
  readCaptionsEnabledPref,
  writeCaptionsEnabledPref,
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

/**
 * Label of the synthetic track that mirrors the resolved caption text for
 * native surfaces (Picture-in-Picture, Apple's fullscreen player). Those draw
 * `showing` cues themselves, out of reach of our overlay — but handing them the
 * raw YouTube ASR cues looks wrong: each cue carries inline `<HH:MM:SS.mmm>`
 * word timings, and Chrome's UA stylesheet paints the not-yet-spoken words grey
 * (`::cue(:future)`), while overlapping roll-up cues double up lines. So the
 * real tracks stay `hidden` everywhere and this track carries one plain cue
 * holding exactly the text our overlay would show, revealed word by word.
 */
const MIRROR_LABEL = "\u200bowntube-native-mirror";
/** Far enough out that the single mirror cue stays active for any playback. */
const MIRROR_CUE_END = 2 ** 31;

/**
 * Whether `video` is on a native surface that draws `showing` cues itself:
 * Picture-in-Picture or Apple's fullscreen player. iPadOS/iOS Safari has no
 * standard PiP API — its PiP (the native control, or auto-PiP when leaving
 * Safari) only shows up as `webkitPresentationMode`.
 */
function isInNativePresentation(video: HTMLVideoElement): boolean {
  const v = video as HTMLVideoElement & {
    webkitDisplayingFullscreen?: boolean;
    webkitPresentationMode?: string;
  };
  return (
    document.pictureInPictureElement === video ||
    v.webkitPresentationMode === "picture-in-picture" ||
    v.webkitPresentationMode === "fullscreen" ||
    v.webkitDisplayingFullscreen === true
  );
}

/** Events that flip {@link isInNativePresentation}. */
const NATIVE_PRESENTATION_EVENTS = [
  "enterpictureinpicture",
  "leavepictureinpicture",
  "webkitbeginfullscreen",
  "webkitendfullscreen",
  "webkitpresentationmodechanged",
] as const;

type MirrorTrack = {
  video: HTMLVideoElement;
  track: TextTrack;
  cue: VTTCue | null;
};

/** Escape text for a VTT cue payload so `<`/`&` read literally, not as markup. */
function escapeCueText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Get (creating on first use per media element) the native mirror track. */
function ensureMirror(
  ref: React.MutableRefObject<MirrorTrack | null>,
  video: HTMLVideoElement,
): MirrorTrack | null {
  if (typeof VTTCue === "undefined" || typeof video.addTextTrack !== "function")
    return null;
  // `addTextTrack` tracks live as long as the element; reuse ours until the
  // block remounts a fresh <video>.
  if (ref.current && ref.current.video === video) return ref.current;
  const track = video.addTextTrack("captions", MIRROR_LABEL);
  track.mode = "hidden";
  ref.current = { video, track, cue: null };
  return ref.current;
}

/** Replace the mirror cue's text (or clear it) so a native surface redraws. */
function setMirrorText(mirror: MirrorTrack | null, text: string | null) {
  if (!mirror) return;
  if (mirror.cue) {
    try {
      mirror.track.removeCue(mirror.cue);
    } catch {
      // Already gone (e.g. track reset) — nothing to remove.
    }
    mirror.cue = null;
  }
  if (text === null) return;
  // A fresh cue per change: swapping active cues is what reliably triggers a
  // native re-layout in both Blink and WebKit (mutating `.text` in place is
  // not).
  const cue = new VTTCue(0, MIRROR_CUE_END, escapeCueText(text));
  mirror.track.addCue(cue);
  mirror.cue = cue;
}

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
 * the chrome renders in its own overlay — that lets us center the lines and lift
 * them above the scrubber. We match `TextTrack`s to
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
  // True while the video is in a native surface (Picture-in-Picture or Apple's
  // fullscreen player) that draws `showing` cues itself. Our in-page overlay
  // must go dark then, or captions render twice — once natively in PiP and once
  // in the (still-visible) inline frame.
  const [nativePresentation, setNativePresentation] = useState(false);
  const mirrorRef = useRef<MirrorTrack | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey rebinds after the media element remounts.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setNativePresentation(isInNativePresentation(video));
      // iOS draws the `showing` mirror cue twice in PiP: in the PiP window
      // and on the inline element, under its "playing in picture in picture"
      // placeholder. Fade the inline element out (globals.css) — opacity on
      // the <video>, not visibility/display on the cue container, because
      // WebKit snapshots that container for the PiP captions.
      const pip =
        (video as HTMLVideoElement & { webkitPresentationMode?: string })
          .webkitPresentationMode === "picture-in-picture" ||
        document.pictureInPictureElement === video;
      if (video.hasAttribute("data-native-pip") !== pip) {
        video.toggleAttribute("data-native-pip", pip);
      }
    };
    sync();
    for (const ev of NATIVE_PRESENTATION_EVENTS) {
      video.addEventListener(ev, sync);
    }
    document.addEventListener("visibilitychange", sync);
    // Fallback: don't rely on the presentation events alone — poll the mode
    // while the page is alive (cheap; a boolean compare every 500 ms).
    const poll = window.setInterval(() => sync(), 500);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", sync);
      for (const ev of NATIVE_PRESENTATION_EVENTS) {
        video.removeEventListener(ev, sync);
      }
    };
  }, [videoRef, reactKey]);

  // On a new source with captions on, start on the track the server marked
  // from the account's caption language (lib/caption-default.ts). A pick in
  // the player only lasts for this video — the setting always wins.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey re-resolves the start track for a new video.
  useEffect(() => {
    if (!readCaptionsEnabledPref()) {
      setActiveIndex(null);
      return;
    }
    const idx = tracks.findIndex((t) => t.isDefault);
    setActiveIndex(idx >= 0 ? idx : tracks.length > 0 ? 0 : null);
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
      // In a NATIVE presentation (Picture-in-Picture, or Apple's fullscreen
      // video player on iPhone) the browser draws only `showing` cues on its
      // own surface, which our in-page overlay can't reach. The active source
      // track still stays `hidden` there (its raw ASR cues would render with
      // grey "future" words and doubled roll-up lines); instead the mirror
      // track — one plain cue holding our resolved text — is set `showing`.
      // Inline (and in our element-fullscreen, where the overlay is on-screen)
      // the mirror stays `hidden` and we render the styled text ourselves.
      const inNativePresentation = isInNativePresentation(video);
      const mirror = wantLabel !== null ? ensureMirror(mirrorRef, video) : null;
      // Without a mirror (no VTTCue support) fall back to showing the raw track
      // natively — imperfect, but better than no captions in PiP.
      const activeMode: TextTrackMode =
        inNativePresentation && !mirror ? "showing" : "hidden";
      const mirrorMode: TextTrackMode =
        inNativePresentation && wantLabel !== null ? "showing" : "hidden";
      const list = video.textTracks;
      for (let i = 0; i < list.length; i++) {
        const tt = list[i];
        if (!tt) continue;
        if (tt.label === MIRROR_LABEL) {
          if (tt.mode !== mirrorMode) tt.mode = mirrorMode;
          continue;
        }
        // Tracks we didn't inject — e.g. dash.js surfacing the DASH manifest's
        // text AdaptationSets (those exist for ExoPlayer on the TV; the web
        // renders captions from its own <track> elements). Force them off, or
        // the browser draws a second, always-on caption bottom-left.
        if (!ourLabels.has(tt.label)) {
          if (tt.mode !== "disabled") tt.mode = "disabled";
          continue;
        }
        const mode: TextTrackMode =
          wantLabel !== null && tt.label === wantLabel
            ? activeMode
            : "disabled";
        if (tt.mode !== mode) tt.mode = mode;
      }
    };

    apply();
    video.addEventListener("loadedmetadata", apply);
    // Re-apply when entering/leaving a native surface so cues switch between our
    // overlay (`hidden`) and native rendering (`showing`).
    for (const ev of NATIVE_PRESENTATION_EVENTS) {
      video.addEventListener(ev, apply);
    }
    video.textTracks.addEventListener?.("addtrack", apply);
    video.textTracks.addEventListener?.("change", apply);
    return () => {
      video.removeEventListener("loadedmetadata", apply);
      for (const ev of NATIVE_PRESENTATION_EVENTS) {
        video.removeEventListener(ev, apply);
      }
      video.textTracks.removeEventListener?.("addtrack", apply);
      video.textTracks.removeEventListener?.("change", apply);
    };
    // nativePresentation: re-apply when the poll (not an event) sees the switch.
  }, [videoRef, tracks, activeIndex, enabled, reactKey, nativePresentation]);

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
      if (video) setMirrorText(mirrorRef.current, null);
      return;
    }
    const mirror = ensureMirror(mirrorRef, video);

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
      // Preserve line breaks: an ASR cue carries the already-spoken line and the
      // building line separated by `\n` — that newline is YouTube's roll-up, so
      // collapse only horizontal whitespace and keep the lines apart.
      const text = out
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
      const next = text.length > 0 ? text : null;
      // Re-push the mirror cue whenever it has gone missing, not only on text
      // changes. hls.js's TimelineController used to wipe every text track's
      // cues on manifest load (`_cleanTracks`); buildHlsSameOriginConfig now
      // disables it, and this stays as a cheap guard against any other wipe.
      const mirrorWiped =
        mirror !== null &&
        mirror.cue !== null &&
        (mirror.track.cues?.length ?? 0) === 0;
      if (next !== shown || (mirrorWiped && next !== null)) {
        shown = next;
        setActiveText(next);
        setMirrorText(mirror, next);
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
      setMirrorText(mirror, null);
      tt?.removeEventListener("cuechange", onCueChange);
      video.removeEventListener("loadedmetadata", onCueChange);
      video.textTracks.removeEventListener?.("change", onCueChange);
    };
  }, [videoRef, tracks, activeIndex, enabled, reactKey]);

  const setActive = useCallback((index: number | null) => {
    setActiveIndex(index);
    writeCaptionsEnabledPref(index !== null);
  }, []);

  if (tracks.length === 0) return { kind: "none" };
  return {
    kind: "tracks",
    items: tracks.map((t) => ({
      label: t.label,
      languageCode: t.languageCode,
    })),
    activeIndex,
    setActive,
    // Suppress the in-page overlay while a native surface (PiP / Apple
    // fullscreen) is drawing the mirrored cue itself, so captions show only there.
    activeText: nativePresentation ? null : activeText,
  };
}
