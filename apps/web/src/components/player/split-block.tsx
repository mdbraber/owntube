"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNativeAdapter } from "@/components/player/player-adapters";
import { usePlayerCaptions } from "@/components/player/player-captions";
import { PlayerChrome } from "@/components/player/player-chrome";
import {
  SHORTS_SHELL_POINTER,
  SPLIT_START_TIMEOUT_MS,
} from "@/components/player/player-constants";
import {
  useMiniPlayerMediaBootstrap,
  useReportVideoIntrinsics,
  useShortsNativeAutoplay,
} from "@/components/player/player-media-hooks";
import type { CaptionTrack } from "@/components/player/player-payload";
import {
  type AudioModel,
  hasMultipleDistinctAudioStreams,
  type ProgressiveQualityMenu,
  type QualityModel,
  withProgressiveQualitySetter,
} from "@/components/player/player-quality";
import type { SponsorBlockChromeProps } from "@/components/player/player-types";
import type { ScrubPreviewConfig } from "@/hooks/use-scrub-frame-preview";
import { languageFirstAudioMenuLabel } from "@/lib/audio-track-label";
import {
  applyCompanionAudioSync,
  companionAudioSyncThresholds,
} from "@/lib/companion-audio-sync";
import { volumeGainFor } from "@/lib/player-volume-gain";
import { cn } from "@/lib/utils";
import type { VideoChapter } from "@/lib/video-chapters";

export function SplitBlock({
  video,
  captions,
  audioTracks,
  defaultAudioIndex = 0,
  poster,
  title,
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
  autoplay = false,
  restoredVolume,
  restoredMuted,
  scrubPreview,
  onVideoIntrinsics,
  isLive = false,
}: SponsorBlockChromeProps & {
  video: string;
  captions?: CaptionTrack[];
  audioTracks: { label: string; src: string }[];
  /** Initial / reset index for the language picker (original when known). */
  defaultAudioIndex?: number;
  poster?: string;
  title: string;
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
  autoplay?: boolean;
  restoredVolume?: number;
  restoredMuted?: boolean;
  scrubPreview?: ScrubPreviewConfig | null;
  onVideoIntrinsics?: (width: number, height: number) => void;
  isLive?: boolean;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const miniShouldAutoplay = miniMode && !miniStartPaused;
  const safeDefaultIdx = Math.min(
    Math.max(0, defaultAudioIndex),
    Math.max(0, audioTracks.length - 1),
  );
  const [splitAudioIdx, setSplitAudioIdx] = useState(safeDefaultIdx);
  const awaitingCompanionAudioRef = useRef(false);
  /** Skips one `pause` side-effect when we pause video ourselves to wait for audio. */
  const ignoreNextVideoPauseRef = useRef(false);
  const initialSeekAppliedRef = useRef(false);
  /** True while the video element is stalled (`waiting`) — blocks companion audio. */
  const videoStalledRef = useRef(false);
  /** True after the video has emitted `playing` at least once for the current source. */
  const videoHasPaintedRef = useRef(false);
  const emitPlaybackError = useCallback(() => {
    if (!onPlaybackError) return;
    window.setTimeout(() => onPlaybackError(), 0);
  }, [onPlaybackError]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: split video/audio defaults reset when the selected variant changes.
  useEffect(() => {
    setSplitAudioIdx(safeDefaultIdx);
  }, [video, audioTracks, safeDefaultIdx]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: video/startAtSeconds reset the one-shot initial seek latch for a new split source.
  useEffect(() => {
    initialSeekAppliedRef.current = false;
  }, [video, startAtSeconds]);

  const activeAudioSrc =
    audioTracks[splitAudioIdx]?.src ?? audioTracks[0]?.src ?? "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: source or audio-track changes clear split playback latches.
  useEffect(() => {
    videoStalledRef.current = false;
    videoHasPaintedRef.current = false;
  }, [video, activeAudioSrc]);

  // Stuck on split HD: no `playing` after user pressed play → trigger variant fallback.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebind stuck-playback watchdog when split video/audio sources change.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const scheduleIfStuck = () => {
      clearTimer();
      if (videoHasPaintedRef.current || v.paused) return;
      timer = setTimeout(() => {
        if (videoHasPaintedRef.current || v.paused) return;
        emitPlaybackError();
      }, SPLIT_START_TIMEOUT_MS);
    };
    const onPlayingClear = () => clearTimer();
    v.addEventListener("play", scheduleIfStuck);
    v.addEventListener("playing", onPlayingClear);
    return () => {
      v.removeEventListener("play", scheduleIfStuck);
      v.removeEventListener("playing", onPlayingClear);
      clearTimer();
    };
  }, [video, activeAudioSrc, emitPlaybackError]);

  // Unlock companion audio on user gesture via adapter.play(), but keep it paused
  // until the video track is actually painting (avoids audible loop while buffering).
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebind companion-audio pause guard when split sources change.
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const onPlay = () => {
      if (!videoHasPaintedRef.current) a.pause();
    };
    v.addEventListener("play", onPlay);
    return () => v.removeEventListener("play", onPlay);
  }, [video, activeAudioSrc]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeAudioSrc remounts/reloads the companion audio element.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.preservesPitch = true;
    a.load();
  }, [activeAudioSrc]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rebind split sync listeners when video/audio source pair changes.
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;

    const canDriveCompanionAudio = (): boolean => {
      if (videoStalledRef.current) return false;
      if (!videoHasPaintedRef.current) return false;
      if (v.paused || v.seeking) return false;
      if (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
      if (a.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
      return true;
    };

    const align = (force = false) => {
      if (!canDriveCompanionAudio()) return;
      applyCompanionAudioSync(v, a, { force });
    };

    let waitingPauseTimer: ReturnType<typeof setTimeout> | null = null;
    let driftRecoveryTimer: ReturnType<typeof setInterval> | null = null;
    const clearWaitingPauseTimer = () => {
      if (!waitingPauseTimer) return;
      clearTimeout(waitingPauseTimer);
      waitingPauseTimer = null;
    };
    const clearDriftRecoveryTimer = () => {
      if (!driftRecoveryTimer) return;
      clearInterval(driftRecoveryTimer);
      driftRecoveryTimer = null;
    };
    const primeDriftRecovery = () => {
      clearDriftRecoveryTimer();
      const { recoveryIntervalMs } = companionAudioSyncThresholds(
        v.playbackRate,
      );
      driftRecoveryTimer = setInterval(() => {
        if (!canDriveCompanionAudio()) return;
        if (a.paused) {
          void a.play().catch(() => {});
          return;
        }
        applyCompanionAudioSync(v, a);
      }, recoveryIntervalMs);
    };
    const resumeCompanionAudio = () => {
      if (!canDriveCompanionAudio()) return;
      align(false);
      if (a.paused) void a.play().catch(() => {});
    };
    const onPlay = () => {
      clearWaitingPauseTimer();
      primeDriftRecovery();
    };
    const onPlaying = () => {
      videoStalledRef.current = false;
      videoHasPaintedRef.current = true;
      clearWaitingPauseTimer();
      primeDriftRecovery();
      resumeCompanionAudio();
    };
    const pauseAudio = () => {
      clearWaitingPauseTimer();
      if (ignoreNextVideoPauseRef.current) {
        ignoreNextVideoPauseRef.current = false;
        return;
      }
      awaitingCompanionAudioRef.current = false;
      a.pause();
    };
    const onWaiting = () => {
      clearWaitingPauseTimer();
      videoStalledRef.current = true;
      // Video stalled — pause audio immediately so it does not run ahead and
      // get snapped back to t≈0 (audible stutter loop while buffering).
      a.pause();
    };
    const alignSeek = () => {
      clearWaitingPauseTimer();
      if (canDriveCompanionAudio()) align(true);
    };
    const onRate = () => {
      a.playbackRate = v.playbackRate;
      if (canDriveCompanionAudio()) {
        align(true);
        primeDriftRecovery();
      }
    };
    const onTabResume = () => {
      if (document.visibilityState === "hidden") return;
      if (v.paused) return;
      clearWaitingPauseTimer();
      a.playbackRate = v.playbackRate;
      resumeCompanionAudio();
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("pause", pauseAudio);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("seeking", alignSeek);
    v.addEventListener("seeked", alignSeek);
    v.addEventListener("ratechange", onRate);
    v.addEventListener("ended", pauseAudio);
    document.addEventListener("visibilitychange", onTabResume);
    window.addEventListener("focus", onTabResume);
    window.addEventListener("pageshow", onTabResume);

    a.playbackRate = v.playbackRate;
    if (!v.paused && videoHasPaintedRef.current) {
      primeDriftRecovery();
      resumeCompanionAudio();
    }
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("pause", pauseAudio);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("seeking", alignSeek);
      v.removeEventListener("seeked", alignSeek);
      v.removeEventListener("ratechange", onRate);
      v.removeEventListener("ended", pauseAudio);
      document.removeEventListener("visibilitychange", onTabResume);
      window.removeEventListener("focus", onTabResume);
      window.removeEventListener("pageshow", onTabResume);
      clearWaitingPauseTimer();
      clearDriftRecoveryTimer();
    };
    // Re-bind when companion audio element is remounted (track change).
  }, [activeAudioSrc, video]);

  const adapter = useNativeAdapter({
    videoRef,
    audioRef,
    externalVolume: volume,
    setExternalVolume: setVolume,
  });

  useReportVideoIntrinsics(videoRef, onVideoIntrinsics);

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

  useShortsNativeAutoplay(
    videoRef,
    shortsMode || miniShouldAutoplay,
    video,
    miniShouldAutoplay,
  );
  useMiniPlayerMediaBootstrap(
    adapter,
    miniMode,
    shortsMode,
    restoredVolume,
    restoredMuted,
  );

  // Autoplay starts the muted video track, but the browser gates the separate
  // (unmuted) companion audio behind a user gesture — so an autoplayed split
  // stream plays silently until the viewer interacts. Resume the audio on the
  // first interaction anywhere (what a manual pause/play does today), then
  // detach. No-op once audio is already running or the user muted it.
  useEffect(() => {
    if (!autoplay || shortsMode || miniMode) return;
    const unlock = () => {
      const v = videoRef.current;
      const a = audioRef.current;
      if (v && a && !v.paused && a.paused && !adapter.muted) {
        a.currentTime = v.currentTime;
        void a.play().catch(() => {});
      }
      detach();
    };
    const detach = () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("touchstart", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    document.addEventListener("touchstart", unlock);
    return detach;
  }, [autoplay, shortsMode, miniMode, adapter.muted]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeAudioSrc reapplies volume to a newly mounted companion audio element.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    // Same gain law as the adapter's companion sync: above 1× without the peak
    // limiter, raw UI gain would skip the rate attenuation and clip.
    const rate = videoRef.current?.playbackRate ?? 1;
    a.volume = adapter.muted
      ? 0
      : Math.min(1, volumeGainFor(volume, rate, false));
  }, [activeAudioSrc, adapter.muted, volume]);

  // Resume companion audio when the audio source is swapped mid-playback (track
  // change). Wait until the video track is actually painting again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeAudioSrc resumes a newly mounted companion audio element when needed.
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a || v.paused) return;

    const syncAndPlay = () => {
      if (videoStalledRef.current) return;
      if (!videoHasPaintedRef.current) return;
      if (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (a.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      a.currentTime = v.currentTime;
      void a.play().catch(() => {});
    };

    if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      syncAndPlay();
      return;
    }
    v.addEventListener("playing", syncAndPlay, { once: true });
    return () => v.removeEventListener("playing", syncAndPlay);
  }, [activeAudioSrc]);

  const quality: QualityModel = progressiveQualityMenu
    ? withProgressiveQualitySetter(
        progressiveQualityMenu,
        setQualityIndex,
        adapter.currentTime,
      )
    : { kind: "none" };
  // `pick-playback` already collapses same-language audio variants into a
  // single language row (one URL per language, highest bitrate), so the
  // entries here can be rendered as-is — no quality re-formatting needed.
  const audioModel: AudioModel = hasMultipleDistinctAudioStreams(audioTracks)
    ? {
        kind: "split-native",
        index: splitAudioIdx,
        setIndex: setSplitAudioIdx,
        items: audioTracks.map((t, idx) => ({
          label:
            t.label?.trim() ||
            languageFirstAudioMenuLabel({
              displayName: null,
              language: null,
              qualityFallback: null,
              streamUrl: t.src,
              index: idx,
            }),
        })),
      }
    : { kind: "none" };

  const captionModel = usePlayerCaptions(videoRef, captions ?? [], video);

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
        ref={videoRef}
        src={video}
        poster={poster}
        playsInline
        muted
        preload="auto"
        autoPlay={shortsMode || autoplay}
        onError={emitPlaybackError}
        onEnded={onEnded}
        className={cn("absolute inset-0 h-full w-full", "object-contain")}
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
      {/* biome-ignore lint/a11y/useMediaCaption: companion audio, no VTT */}
      <audio
        ref={audioRef}
        key={activeAudioSrc}
        src={activeAudioSrc}
        preload="auto"
        onError={emitPlaybackError}
        className="hidden"
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
        audio={audioModel}
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
                streamSrc: video,
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
