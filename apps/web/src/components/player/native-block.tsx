"use client";

import { useCallback, useEffect, useRef } from "react";
import { useNativeAdapter } from "@/components/player/player-adapters";
import { PlayerChrome } from "@/components/player/player-chrome";
import { SHORTS_SHELL_POINTER } from "@/components/player/player-constants";
import {
  useMiniPlayerMediaBootstrap,
  useReportVideoIntrinsics,
  useShortsNativeAutoplay,
} from "@/components/player/player-media-hooks";
import {
  type ProgressiveQualityMenu,
  type QualityModel,
  withProgressiveQualitySetter,
} from "@/components/player/player-quality";
import type { SponsorBlockChromeProps } from "@/components/player/player-types";
import type { ScrubPreviewConfig } from "@/hooks/use-scrub-frame-preview";
import { cn } from "@/lib/utils";
import type { VideoChapter } from "@/lib/video-chapters";

export function NativeMuxedBlock({
  src,
  poster,
  title,
  reactKey,
  volume,
  setVolume,
  progressiveQualityMenu,
  setQualityIndex,
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
  restoredVolume,
  restoredMuted,
  scrubPreview,
  onVideoIntrinsics,
  isLive = false,
}: SponsorBlockChromeProps & {
  src: string;
  poster?: string;
  title: string;
  reactKey: string;
  volume: number;
  setVolume: (v: number) => void;
  progressiveQualityMenu: ProgressiveQualityMenu | null;
  setQualityIndex: (i: number, seekSeconds?: number) => void;
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
  restoredVolume?: number;
  restoredMuted?: boolean;
  scrubPreview?: ScrubPreviewConfig | null;
  onVideoIntrinsics?: (width: number, height: number) => void;
  isLive?: boolean;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initialSeekAppliedRef = useRef(false);
  const miniShouldAutoplay = miniMode && !miniStartPaused;
  const emitPlaybackError = useCallback(() => {
    if (!onPlaybackError) return;
    window.setTimeout(() => onPlaybackError(), 0);
  }, [onPlaybackError]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey/startAtSeconds reset the one-shot initial seek latch for a new native source.
  useEffect(() => {
    initialSeekAppliedRef.current = false;
  }, [reactKey, startAtSeconds]);

  const adapter = useNativeAdapter({
    videoRef,
    audioRef,
    externalVolume: volume,
    setExternalVolume: setVolume,
  });

  useReportVideoIntrinsics(videoRef, onVideoIntrinsics);

  useShortsNativeAutoplay(
    videoRef,
    shortsMode || miniShouldAutoplay,
    reactKey,
    miniShouldAutoplay,
  );
  useMiniPlayerMediaBootstrap(
    adapter,
    miniMode,
    shortsMode,
    restoredVolume,
    restoredMuted,
  );

  useEffect(() => {
    if (initialSeekAppliedRef.current) return;
    if (!adapter.canPlay) return;
    if (
      typeof startAtSeconds !== "number" ||
      !Number.isFinite(startAtSeconds) ||
      startAtSeconds < 0
    ) {
      return;
    }
    adapter.seek(startAtSeconds);
    initialSeekAppliedRef.current = true;
  }, [adapter, startAtSeconds]);

  const quality: QualityModel = progressiveQualityMenu
    ? withProgressiveQualitySetter(
        progressiveQualityMenu,
        setQualityIndex,
        adapter.currentTime,
      )
    : { kind: "none" };

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className={cn(
        "group/player relative overflow-hidden bg-black focus:outline-none",
        shortsMode
          ? SHORTS_SHELL_POINTER
          : cinemaMode
            ? "aspect-video w-full max-h-[min(88vh,92dvh)] rounded-lg shadow-xl ring-1 ring-white/10"
            : "aspect-video w-full",
      )}
    >
      <video
        key={reactKey}
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="auto"
        autoPlay={shortsMode || miniShouldAutoplay}
        muted={shortsMode}
        onError={emitPlaybackError}
        onEnded={onEnded}
        className={cn(
          shortsMode
            ? "relative z-0 h-full w-full object-contain"
            : "absolute inset-0 h-full w-full object-contain",
        )}
      />
      <PlayerChrome
        adapter={adapter}
        shellRef={shellRef}
        title={title}
        chapters={chapters}
        videoId={videoId}
        sponsorSegments={sponsorSegments}
        sponsorBlockPrefs={sponsorBlockPrefs}
        quality={quality}
        audio={{ kind: "none" }}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={onSettingsOpenChange}
        cinemaMode={cinemaMode}
        onExitCinema={onExitCinema}
        onToggleCinema={onToggleCinema}
        scrubPreview={
          isLive
            ? null
            : (scrubPreview ?? {
                streamSrc: src,
                ...(poster ? { poster } : {}),
              })
        }
        nextUp={nextUp}
        queue={queue}
        autoplayNext={autoplayNext}
        onToggleAutoplayNext={onToggleAutoplayNext}
        onPlayNext={onPlayNext}
        miniMode={miniMode}
        shortsMode={shortsMode}
        miniStartPaused={miniStartPaused}
        isLive={isLive}
      />
    </div>
  );
}
