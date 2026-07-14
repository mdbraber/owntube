"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNativeAdapter } from "@/components/player/player-adapters";
import { usePlayerCaptions } from "@/components/player/player-captions";
import { PlayerChrome } from "@/components/player/player-chrome";
import {
  useMiniPlayerMediaBootstrap,
  useReportVideoIntrinsics,
} from "@/components/player/player-media-hooks";
import type { CaptionTrack } from "@/components/player/player-payload";
import type { SponsorBlockChromeProps } from "@/components/player/player-types";
import { useBackgroundPlayback } from "@/hooks/use-background-playback";
import {
  pickDashVideoFamily,
  useDashPlayback,
} from "@/hooks/use-dash-playback";
import { useHlsVodPlayback } from "@/hooks/use-hls-vod-playback";
import { isIosLikeBrowser } from "@/lib/ios-playback";
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
  miniMode = false,
  shortsMode = false,
  miniStartPaused = false,
  autoplay = false,
  restoredVolume,
  restoredMuted,
  onVideoIntrinsics,
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
  miniMode?: boolean;
  shortsMode?: boolean;
  miniStartPaused?: boolean;
  autoplay?: boolean;
  restoredVolume?: number;
  restoredMuted?: boolean;
  onVideoIntrinsics?: (width: number, height: number) => void;
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
    if (
      dashFailed ||
      shortsMode ||
      !videoId ||
      !src.startsWith("/hls/") ||
      isIosLikeBrowser()
    ) {
      setDashDecision({ key: reactKey, src: null });
      return;
    }
    const family = pickDashVideoFamily();
    setDashDecision({
      key: reactKey,
      src: family
        ? `/dash/${encodeURIComponent(videoId)}/manifest.mpd?video=${family}`
        : null,
    });
  }, [src, videoId, reactKey, shortsMode, dashFailed]);
  const decided = dashDecision?.key === reactKey;
  const dashSrc = decided ? dashDecision.src : null;

  useHlsVodPlayback(
    videoRef,
    decided && !dashSrc ? src : "",
    reactKey,
    startAtSeconds,
    shortsMode || miniShouldAutoplay || autoplay,
    emitPlaybackError,
  );

  useDashPlayback(
    videoRef,
    dashSrc ?? "",
    reactKey,
    startAtSeconds,
    shortsMode || miniShouldAutoplay || autoplay,
    () => setDashFailedKey(reactKey),
  );

  const adapter = useNativeAdapter({
    videoRef,
    audioRef,
    externalVolume: volume,
    setExternalVolume: setVolume,
  });

  const captionModel = usePlayerCaptions(
    videoRef,
    captions ?? [],
    reactKey,
    true,
  );

  useReportVideoIntrinsics(videoRef, onVideoIntrinsics);

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
        "group/player relative overflow-hidden bg-black focus:outline-none",
        cinemaMode
          ? "aspect-video w-full max-h-[min(88vh,92dvh)] rounded-lg shadow-xl ring-1 ring-white/10"
          : "aspect-video w-full",
      )}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: subtitle <track>s are provided dynamically from the `captions` prop (mapped children the rule can't statically see). */}
      <video
        key={reactKey}
        ref={videoRef}
        poster={poster}
        playsInline
        preload="auto"
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
        quality={{ kind: "none" }}
        audio={{ kind: "none" }}
        captions={captionModel}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={onSettingsOpenChange}
        cinemaMode={cinemaMode}
        onExitCinema={onExitCinema}
        onToggleCinema={onToggleCinema}
        scrubPreview={null}
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
