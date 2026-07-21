"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNativeAdapter } from "@/components/player/player-adapters";
import { usePlayerCaptions } from "@/components/player/player-captions";
import { PlayerChrome } from "@/components/player/player-chrome";
import {
  useMiniPlayerMediaBootstrap,
  useReportVideoIntrinsics,
  useShortsNativeAutoplay,
} from "@/components/player/player-media-hooks";
import type { CaptionTrack } from "@/components/player/player-payload";
import type { QualityModel } from "@/components/player/player-quality";
import type { SponsorBlockChromeProps } from "@/components/player/player-types";
import { useBackgroundPlayback } from "@/hooks/use-background-playback";
import {
  pickDashVideoFamily,
  useDashPlayback,
} from "@/hooks/use-dash-playback";
import { useHlsVodPlayback } from "@/hooks/use-hls-vod-playback";
import type { ScrubPreviewConfig } from "@/hooks/use-scrub-frame-preview";
import { isIosLikeBrowser } from "@/lib/ios-playback";
import { getMediaOrigin } from "@/lib/media-origin";
import {
  getShortsMuted,
  useShortsAudioPersist,
  useShortsUnmuteAfterPlay,
} from "@/lib/shorts-audio-pref";
import { cn } from "@/lib/utils";
import type { VideoChapter } from "@/lib/video-chapters";

/**
 * Plays OwnTube's server-generated VOD HLS (`/hls/<id>/master.m3u8`) on a plain
 * `<video>`: native HLS on Safari/iOS (hardware-decoded, reliable seeking) and
 * hls.js everywhere else, both driven by `useHlsVodPlayback`. Segments already
 * resolve to the same-origin `/invidious/videoplayback` companion proxy, so no
 * googlevideo URL reaches the browser.
 *
 * Modeled on `NativeMuxedBlock`; the source is attached by the hook (never via
 * a `src` attribute), and `useNativeAdapter` drives OwnTube's `PlayerChrome`.
 * OwnTube's chrome is used on every platform (including iOS) so SponsorBlock
 * segments/skipping and the rest of the custom UI are always available — the
 * same as the mini player and the muxed/split blocks.
 */
export function HlsVodBlock({
  src,
  poster,
  title,
  reactKey,
  captions,
  volume,
  setVolume,
  settingsOpen,
  onSettingsOpenChange,
  chapters,
  videoId,
  sponsorSegments,
  sponsorBlockPrefs,
  startAtSeconds,
  cinemaMode,
  onExitCinema,
  onToggleCinema,
  onPlaybackError,
  onEnded,
  nextUp,
  queue,
  autoplayNext,
  onToggleAutoplayNext,
  onPlayNext,
  scrubPreview,
  miniMode = false,
  shortsMode = false,
  shortsActive = true,
  miniStartPaused = false,
  autoplay = false,
  restoredVolume,
  restoredMuted,
  onVideoIntrinsics,
  defaultQualityHeightCap = 1080,
  fullscreenAutoBestQuality = false,
}: SponsorBlockChromeProps & {
  src: string;
  poster?: string;
  title: string;
  reactKey: string;
  captions?: CaptionTrack[];
  volume: number;
  setVolume: (v: number) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  chapters: VideoChapter[];
  startAtSeconds?: number;
  cinemaMode: boolean;
  onExitCinema: () => void;
  onToggleCinema: () => void;
  onPlaybackError?: () => void;
  onEnded?: () => void;
  nextUp?: { href: string; title: string } | null;
  queue?: { href: string; title: string }[];
  autoplayNext: boolean;
  onToggleAutoplayNext: () => void;
  onPlayNext: () => void;
  scrubPreview?: ScrubPreviewConfig | null;
  miniMode?: boolean;
  shortsMode?: boolean;
  shortsActive?: boolean;
  miniStartPaused?: boolean;
  autoplay?: boolean;
  restoredVolume?: number;
  restoredMuted?: boolean;
  onVideoIntrinsics?: (width: number, height: number) => void;
  /** DASH ABR ceiling (both windowed and fullscreen) — null means uncapped. */
  defaultQualityHeightCap?: number | null;
  /** Jump to the best DASH quality on entering fullscreen, restore on exit. */
  fullscreenAutoBestQuality?: boolean;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Last start time seeked to. Lets a `?t=` change (chapter click — a soft nav
   *  that does not remount the element) re-seek; normal playback does not. */
  const lastAppliedStartRef = useRef<number | undefined>(undefined);
  const miniShouldAutoplay = miniMode && !miniStartPaused;
  const emitPlaybackError = useCallback(() => {
    if (!onPlaybackError) return;
    window.setTimeout(() => onPlaybackError(), 0);
  }, [onPlaybackError]);

  // Upgrade the synthesized-HLS source to our synthesized DASH manifest when
  // the browser can MSE-decode a better ladder (VP9/AV1 → >1080p; the HLS
  // path is AVC-only). iOS keeps native HLS — MSE strands video there. A
  // dash.js fatal error drops back to the HLS path for this stream. Decided
  // post-mount (capability probes are browser-only), so both hooks below see
  // an empty src until then and neither double-initializes.
  const [dashDecision, setDashDecision] = useState<{
    key: string;
    src: string | null;
  } | null>(null);
  const [dashFailedKey, setDashFailedKey] = useState<string | null>(null);
  const dashFailed = dashFailedKey === reactKey;
  useEffect(() => {
    // `src` is our own synthesized HLS manifest (absolute, on the media
    // origin — see media-origin.ts) whenever it's this pathname; check the
    // path rather than a "/hls/" prefix since it's no longer relative.
    const srcPathname = (() => {
      try {
        return new URL(src, window.location.href).pathname;
      } catch {
        return "";
      }
    })();
    if (
      dashFailed ||
      shortsMode ||
      !videoId ||
      !srcPathname.startsWith("/hls/") ||
      isIosLikeBrowser()
    ) {
      setDashDecision({ key: reactKey, src: null });
      return;
    }
    const family = pickDashVideoFamily();
    setDashDecision({
      key: reactKey,
      src: family
        ? `${getMediaOrigin(window.location.origin)}/dash/${encodeURIComponent(videoId)}/manifest.mpd?video=${family}`
        : null,
    });
  }, [src, videoId, reactKey, shortsMode, dashFailed]);
  const decided = dashDecision?.key === reactKey;
  const dashSrc = decided ? dashDecision.src : null;

  /**
   * Whether the active short *should* be playing — the source of truth the
   * autoplay drivers read, instead of `shortsActive` alone.
   *
   * `shortsActive` only means "this is the visible short"; treating it as "play
   * this" is what let a paused short resume when the player re-attached (iOS
   * re-fires canplay on foreground, and the fragile per-hook `startedOnce`
   * guards reset). Derive intent from real play/pause transitions instead, held
   * as component state so it survives those re-attaches and every driver agrees.
   *
   * Resets to true per stream, so swiping to a new short still autoplays.
   */
  const [shortsWantsPlay, setShortsWantsPlay] = useState(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per stream
  useEffect(() => {
    setShortsWantsPlay(true);
  }, [reactKey]);
  useEffect(() => {
    if (!shortsMode) return;
    const el = videoRef.current;
    if (!el) return;
    const onPause = () => setShortsWantsPlay(false);
    const onPlay = () => setShortsWantsPlay(true);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlay);
    return () => {
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlay);
    };
  }, [videoRef, shortsMode, reactKey]);

  const shortsShouldPlay = shortsMode && shortsActive && shortsWantsPlay;

  useHlsVodPlayback(
    videoRef,
    decided && !dashSrc ? src : "",
    reactKey,
    startAtSeconds,
    shortsShouldPlay || miniShouldAutoplay || autoplay,
    emitPlaybackError,
  );

  const dashQuality = useDashPlayback(
    videoRef,
    dashSrc ?? "",
    reactKey,
    startAtSeconds,
    shortsShouldPlay || miniShouldAutoplay || autoplay,
    () => setDashFailedKey(reactKey),
    defaultQualityHeightCap,
    fullscreenAutoBestQuality,
  );
  // "Auto" (capped default) is a synthetic item at index 0, followed by
  // dash.js's own representation list. QualityModel is index-based (menu
  // position), but useDashPlayback works in representation ids (stable
  // regardless of dash.js's live, bitrate-filtered array reordering) — this
  // is the translation layer between the two. No selector at all for the
  // HLS-only case (AVC caps at 1080p — nothing to select among) or before
  // the manifest has parsed (empty items).
  const dashQualityModel: QualityModel = useMemo(() => {
    if (!dashSrc || dashQuality.items.length === 0) return { kind: "none" };
    const activeItemIndex = dashQuality.items.findIndex(
      (it) => it.id === dashQuality.activeId,
    );
    return {
      kind: "progressive",
      items: [{ label: "Auto" }, ...dashQuality.items],
      index:
        dashQuality.mode === "auto"
          ? 0
          : activeItemIndex >= 0
            ? activeItemIndex + 1
            : 0,
      setIndex: (i: number) => {
        if (i === 0) {
          dashQuality.setQuality(null);
          return;
        }
        const picked = dashQuality.items[i - 1];
        if (picked) dashQuality.setQuality(picked.id);
      },
    };
  }, [dashSrc, dashQuality]);

  const adapter = useNativeAdapter({
    videoRef,
    audioRef,
    externalVolume: volume,
    setExternalVolume: setVolume,
    // Seed the mute from the shared shorts pref (muted until the viewer unmutes
    // one, then it stays on across shorts).
    initialMuted: shortsMode ? getShortsMuted() : undefined,
  });
  useShortsAudioPersist(adapter.muted, shortsMode);
  useShortsUnmuteAfterPlay(videoRef, shortsMode, reactKey);

  const captionModel = usePlayerCaptions(
    videoRef,
    captions ?? [],
    reactKey,
    true,
  );

  useReportVideoIntrinsics(videoRef, onVideoIntrinsics);

  // Shorts autoplay: the browser blocks unmuted autoplay, so (like the muxed
  // block) keep retrying play on canplay/loadeddata — muted while the shared
  // pref is muted so it can start, unmuted once the viewer has turned sound on.
  useShortsNativeAutoplay(videoRef, shortsShouldPlay, reactKey, shortsMode);

  // Lock-screen / Control Center metadata and transport controls.
  useBackgroundPlayback(videoRef, {
    title,
    poster,
    enabled: !miniMode && !shortsMode,
  });

  // Re-seek whenever the requested start time changes to a NEW value. The
  // initial position is handled by `useHlsVodPlayback` (on loadedmetadata), but
  // a chapter click is a soft nav that changes `startAtSeconds` WITHOUT
  // remounting the element or reloading the source, so nothing else re-seeks.
  // `lastAppliedStartRef` keeps ordinary playback/scrubbing from re-seeking.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (
      typeof startAtSeconds !== "number" ||
      !Number.isFinite(startAtSeconds) ||
      startAtSeconds < 0
    ) {
      return;
    }
    if (lastAppliedStartRef.current === startAtSeconds) return;
    const apply = () => {
      lastAppliedStartRef.current = startAtSeconds;
      adapter.seek(startAtSeconds);
    };
    if (v.readyState >= 1) {
      apply();
    } else {
      v.addEventListener("loadedmetadata", apply, { once: true });
      return () => v.removeEventListener("loadedmetadata", apply);
    }
  }, [adapter, startAtSeconds]);

  useMiniPlayerMediaBootstrap(
    adapter,
    miniMode,
    shortsMode,
    restoredVolume,
    restoredMuted,
  );

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className={cn(
        // Transparent in shorts so the slide's thumbnail backdrop shows through
        // while buffering / behind letterboxing; black everywhere else.
        "group/player relative overflow-hidden focus:outline-none",
        shortsMode
          ? "h-full w-full bg-transparent"
          : cinemaMode
            ? "aspect-video w-full max-h-[min(88vh,92dvh)] rounded-lg bg-black shadow-xl ring-1 ring-white/10"
            : "aspect-video w-full bg-black",
      )}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: subtitle <track>s are provided dynamically from the `captions` prop (mapped children the rule can't statically see). */}
      <video
        key={reactKey}
        ref={videoRef}
        poster={shortsMode ? undefined : poster}
        muted={shortsMode}
        playsInline
        preload="auto"
        // Video/segments (dash.js/hls.js fetch these themselves, unaffected
        // by this attribute) and caption <track>s now live on the media
        // origin (see media-origin.ts) — cross-origin <track> loading
        // requires this. No credentials needed (media routes don't check
        // session), so "anonymous" (no cookies) is correct.
        crossOrigin="anonymous"
        onError={emitPlaybackError}
        onEnded={onEnded}
        className="absolute inset-0 h-full w-full object-contain"
      >
        {(captions ?? []).map((track) => (
          <track
            key={`${track.languageCode}-${track.label}`}
            kind="subtitles"
            srcLang={track.languageCode}
            label={track.label}
            src={track.src}
          />
        ))}
      </video>
      <PlayerChrome
        adapter={adapter}
        shellRef={shellRef}
        title={title}
        chapters={chapters}
        videoId={videoId}
        sponsorSegments={sponsorSegments}
        sponsorBlockPrefs={sponsorBlockPrefs}
        quality={dashQualityModel}
        audio={{ kind: "none" }}
        captions={captionModel}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={onSettingsOpenChange}
        cinemaMode={cinemaMode}
        onExitCinema={onExitCinema}
        onToggleCinema={onToggleCinema}
        scrubPreview={scrubPreview ?? null}
        nextUp={nextUp}
        queue={queue}
        autoplayNext={autoplayNext}
        onToggleAutoplayNext={onToggleAutoplayNext}
        onPlayNext={onPlayNext}
        miniMode={miniMode}
        shortsMode={shortsMode}
        miniStartPaused={miniStartPaused}
      />
    </div>
  );
}
