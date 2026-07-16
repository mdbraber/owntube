"use client";

import { useCallback, useEffect, useRef } from "react";
import { useNativeAdapter } from "@/components/player/player-adapters";
import { usePlayerCaptions } from "@/components/player/player-captions";
import { PlayerChrome } from "@/components/player/player-chrome";
import { SHORTS_SHELL_POINTER } from "@/components/player/player-constants";
import {
  useMiniPlayerMediaBootstrap,
  useReportVideoIntrinsics,
  useShortsNativeAutoplay,
} from "@/components/player/player-media-hooks";
import type { CaptionTrack } from "@/components/player/player-payload";
import {
  type ProgressiveQualityMenu,
  type QualityModel,
  withProgressiveQualitySetter,
} from "@/components/player/player-quality";
import type { SponsorBlockChromeProps } from "@/components/player/player-types";
import type { ScrubPreviewConfig } from "@/hooks/use-scrub-frame-preview";
import {
  getShortsMuted,
  useShortsAudioPersist,
  useShortsUnmuteAfterPlay,
} from "@/lib/shorts-audio-pref";
import { cn } from "@/lib/utils";
import type { VideoChapter } from "@/lib/video-chapters";

export function NativeMuxedBlock({
  src,
  poster,
  title,
  reactKey,
  captions,
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
  shortsActive = true,
  miniStartPaused = false,
  autoplay = false,
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
  captions?: CaptionTrack[];
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
  shortsActive?: boolean;
  miniStartPaused?: boolean;
  autoplay?: boolean;
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
    // Seed the adapter's mute from the shared shorts pref so a short mounts with
    // the viewer's current choice (muted until they unmute one, then stays on).
    initialMuted: shortsMode ? getShortsMuted() : undefined,
  });
  // Persist the viewer's mute choice across shorts, and re-apply it once the
  // (always-muted-to-autoplay) short is actually playing.
  useShortsAudioPersist(adapter.muted, shortsMode);
  useShortsUnmuteAfterPlay(videoRef, shortsMode, reactKey);

  const captionModel = usePlayerCaptions(videoRef, captions ?? [], reactKey);

  useReportVideoIntrinsics(videoRef, onVideoIntrinsics);

  // Always mute for the autoplay attempt in shorts — unmuted autoplay is
  // blocked on a fresh element even after interaction. Sound (if the viewer
  // wants it) is restored by useShortsUnmuteAfterPlay once playback starts.
  useShortsNativeAutoplay(
    videoRef,
    // Only the ACTIVE short plays; a pre-warmed adjacent one attaches + buffers
    // but stays paused until it becomes active.
    (shortsMode && shortsActive) || miniShouldAutoplay,
    reactKey,
    shortsMode || miniShouldAutoplay,
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
        // Transparent in shorts so the slide's thumbnail backdrop shows through
        // while buffering / behind letterboxing; black everywhere else.
        "group/player relative overflow-hidden focus:outline-none",
        shortsMode
          ? cn(SHORTS_SHELL_POINTER, "bg-transparent")
          : cinemaMode
            ? "aspect-video w-full max-h-[min(88vh,92dvh)] rounded-lg bg-black shadow-xl ring-1 ring-white/10"
            : "aspect-video w-full bg-black",
      )}
    >
      <video
        key={reactKey}
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="auto"
        autoPlay={(shortsMode && shortsActive) || miniShouldAutoplay || autoplay}
        muted={shortsMode}
        onError={emitPlaybackError}
        onEnded={onEnded}
        className={cn(
          shortsMode
            ? "relative z-0 h-full w-full object-contain"
            : "absolute inset-0 h-full w-full object-contain",
        )}
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
        quality={quality}
        audio={{ kind: "none" }}
        captions={captionModel}
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
