"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNativeAdapter } from "@/components/player/player-adapters";
import { PlayerChrome } from "@/components/player/player-chrome";
import {
  useMiniPlayerMediaBootstrap,
  useReportVideoIntrinsics,
} from "@/components/player/player-media-hooks";
import type { SponsorBlockChromeProps } from "@/components/player/player-types";
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
 * On iOS we hand off to Apple's native controls — bulletproof seeking.
 */
export function HlsVodBlock({
  src,
  poster,
  title,
  reactKey,
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
  // iOS Safari plays HLS natively; hand off to Apple's own player UI (native
  // scrub bar + fullscreen) — bulletproof seeking, none of our custom-overlay
  // jank. Client-only to avoid a hydration mismatch. Not for mini/shorts, which
  // need the inline custom chrome. Elsewhere we keep OwnTube's PlayerChrome.
  const [useNativeControls, setUseNativeControls] = useState(false);
  useEffect(() => {
    setUseNativeControls(isIosLikeBrowser() && !miniMode && !shortsMode);
  }, [miniMode, shortsMode]);
  const emitPlaybackError = useCallback(() => {
    if (!onPlaybackError) return;
    window.setTimeout(() => onPlaybackError(), 0);
  }, [onPlaybackError]);

  useHlsVodPlayback(
    videoRef,
    src,
    reactKey,
    startAtSeconds,
    shortsMode || miniShouldAutoplay || autoplay,
    emitPlaybackError,
  );

  const adapter = useNativeAdapter({
    videoRef,
    audioRef,
    externalVolume: volume,
    setExternalVolume: setVolume,
  });

  useReportVideoIntrinsics(videoRef, onVideoIntrinsics);

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
      {/* biome-ignore lint/a11y/useMediaCaption: HLS captions are not exposed as local text tracks here. */}
      <video
        key={reactKey}
        ref={videoRef}
        poster={poster}
        playsInline
        preload="auto"
        controls={useNativeControls}
        onError={emitPlaybackError}
        onEnded={onEnded}
        className="absolute inset-0 h-full w-full object-contain"
      />
      {useNativeControls ? null : (
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
      )}
    </div>
  );
}
