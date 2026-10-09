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
import {
  type AudioModel,
  dashQualityModel,
  type QualityModel,
} from "@/components/player/player-quality";
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
  dvr = false,
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
  /** Post-Live-DVR: DASH is the only working path, including on iOS. */
  dvr?: boolean;
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
    // Post-Live-DVR is the one case iOS must still take DASH: `/hls/` can't be
    // synthesized (no byte-range formats, so it 502s) and Invidious's native
    // hlsUrl is un-deciphered and 403s, leaving an infinite spinner. The /dash
    // route proxies invidious-companion's manifest, which is MP4/AVC + AAC
    // only — decodable by iPad Safari's MSE (and ManagedMediaSource on iOS
    // 17.1+, which `useDashPlayback` already configures).
    if (
      dashFailed ||
      shortsMode ||
      !videoId ||
      !srcPathname.startsWith("/hls/") ||
      (isIosLikeBrowser() && !dvr)
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
  }, [src, videoId, reactKey, shortsMode, dashFailed, dvr]);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: the <video> is keyed by reactKey, so a new stream is a new element to re-attach to.
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

  const hlsAudio = useHlsVodPlayback(
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
  // No selector for the HLS-only case (AVC caps at 1080p — nothing to select
  // among); see dashQualityModel for the DASH menu itself.
  const qualityModel: QualityModel = useMemo(
    () => (dashSrc ? dashQualityModel(dashQuality) : { kind: "none" }),
    [dashSrc, dashQuality],
  );

  // Language picker rows come from whichever engine is active: dash.js's
  // manifest tracks on the DASH upgrade path, hls.js/native renditions
  // otherwise. Single-language videos leave `items` empty → no menu entry.
  const activeAudio = dashSrc ? dashQuality.audio : hlsAudio;
  const audioModel: AudioModel =
    activeAudio.items.length > 1
      ? {
          kind: "tracks",
          index: activeAudio.index,
          setIndex: activeAudio.setIndex,
          items: activeAudio.items,
        }
      : { kind: "none" };

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

  // Sidecar caption <track>s join the element only once its source has loaded
  // metadata. iOS's native HLS player rejects the manifest outright
  // (MEDIA_ERR_SRC_NOT_SUPPORTED, no segment ever fetched) when the <video>
  // already holds <track> children as it starts loading — reproduced on an
  // iPhone with the production manifest: with the tracks 3/3 failures, without
  // or added after loadedmetadata every run played. The manifest carries the
  // same captions in-band meanwhile. Keyed on the active source so a swap hides
  // them again in the same commit, before the new source is attached.
  const activeSource = `${reactKey}|${dashSrc ?? (decided ? src : "")}`;
  const [captionsReadyFor, setCaptionsReadyFor] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the <video> is keyed by reactKey, so a new stream is a new element to listen on.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const ready = () => setCaptionsReadyFor(activeSource);
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA && el.currentSrc) {
      ready();
      return;
    }
    el.addEventListener("loadedmetadata", ready);
    return () => el.removeEventListener("loadedmetadata", ready);
  }, [videoRef, activeSource]);
  const sidecarCaptions = useMemo(
    () => (captionsReadyFor === activeSource ? (captions ?? []) : []),
    [captionsReadyFor, activeSource, captions],
  );

  const captionModel = usePlayerCaptions(
    videoRef,
    sidecarCaptions,
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
      <video
        key={reactKey}
        ref={videoRef}
        poster={shortsMode ? undefined : poster}
        muted={shortsMode}
        playsInline
        preload="auto"
        x-webkit-airplay="allow"
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
        {sidecarCaptions.map((track) => (
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
        quality={qualityModel}
        audio={audioModel}
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
