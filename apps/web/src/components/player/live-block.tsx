"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNativeAdapter } from "@/components/player/player-adapters";
import { usePlayerCaptions } from "@/components/player/player-captions";
import { PlayerChrome } from "@/components/player/player-chrome";
import { useReportVideoIntrinsics } from "@/components/player/player-media-hooks";
import type { HlsBlockProps } from "@/components/player/player-types";
import { useHlsVodPlayback } from "@/hooks/use-hls-vod-playback";
import { useLiveIdleStop } from "@/hooks/use-live-idle-stop";
import {
  readPlayerMediaPrefs,
  writePlayerVolumeOnly,
} from "@/lib/player-media-prefs";
import { cn } from "@/lib/utils";

/**
 * Over a live player stopped for idleness (see live-idle-stop.ts): asks
 * whether anyone is still watching, and reloads the broadcast at the live
 * edge when they are. Above the controls, which have no source to drive.
 */
function StillWatchingScreen({ onResume }: { onResume: () => void }) {
  return (
    <div className="absolute inset-0 z-50 grid place-content-center justify-items-center gap-3 bg-black/80 text-center text-sm text-white/70">
      <output className="text-[clamp(1rem,3.2vmin,1.5rem)] leading-tight text-white">
        Still watching?
      </output>
      <span className="px-4">
        The live stream was stopped after 3 hours without activity.
      </span>
      <button
        type="button"
        onClick={onResume}
        className="mt-1 rounded-full bg-white/15 px-4 py-1.5 text-white transition hover:bg-white/25"
      >
        Continue watching
      </button>
    </div>
  );
}

/**
 * A live broadcast (or post-live DVR): the gateway's live HLS, on hls.js or
 * the browser's own HLS, joining at the live edge.
 */
export function LiveBlock({
  src,
  poster,
  title,
  reactKey,
  captions,
  settingsOpen,
  onSettingsOpenChange,
  chapters,
  videoId,
  sponsorSegments,
  sponsorBlockPrefs,
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
  restoredVolume,
  onVideoIntrinsics,
}: HlsBlockProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [volume, setVolume] = useState(() => readPlayerMediaPrefs().volume);

  const emitPlaybackError = useCallback(() => {
    if (!onPlaybackError) return;
    window.setTimeout(() => onPlaybackError(), 0);
  }, [onPlaybackError]);

  // "Still watching?": after hours without interaction the player is torn
  // down and the source detached, so nothing polls the live playlist (hls.js
  // keeps refreshing it even while paused). Resuming builds a fresh
  // instance under a new key, which joins at the live edge and autoplays.
  const [idleStopped, setIdleStopped] = useState(false);
  const [resumeCount, setResumeCount] = useState(0);
  const sourceKey = `${reactKey}#${resumeCount}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new broadcast starts out playing, not stopped.
  useEffect(() => {
    setIdleStopped(false);
  }, [reactKey]);
  useLiveIdleStop(!idleStopped, () => {
    const video = videoRef.current;
    if (video && document.pictureInPictureElement === video) {
      void document.exitPictureInPicture().catch(() => {});
    }
    setIdleStopped(true);
  });
  const resumeAfterIdle = useCallback(() => {
    setResumeCount((n) => n + 1);
    setIdleStopped(false);
  }, []);

  // Autoplay is the effect below (and the hook itself after an idle resume);
  // no start time, so playback joins at the live edge.
  useHlsVodPlayback(
    videoRef,
    idleStopped ? "" : src,
    sourceKey,
    undefined,
    resumeCount > 0,
    emitPlaybackError,
  );

  const adapter = useNativeAdapter({
    videoRef,
    audioRef,
    externalVolume: volume,
    setExternalVolume: setVolume,
    castSelf: true,
  });

  const captionModel = usePlayerCaptions(videoRef, captions ?? [], reactKey);

  useReportVideoIntrinsics(videoRef, onVideoIntrinsics);

  useEffect(() => {
    const t = window.setTimeout(() => writePlayerVolumeOnly(volume), 200);
    return () => window.clearTimeout(t);
  }, [volume]);

  useEffect(() => {
    if (
      typeof restoredVolume !== "number" ||
      !Number.isFinite(restoredVolume)
    ) {
      return;
    }
    setVolume(restoredVolume);
  }, [restoredVolume]);

  // Autoplay the broadcast once per source; the guard keeps the effect from
  // re-playing after a deliberate user pause.
  const liveAutoplayTriedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sourceKey resets live autoplay once per broadcast source (and idle resume).
  useEffect(() => {
    liveAutoplayTriedRef.current = false;
  }, [sourceKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sourceKey retries live autoplay after a source remount.
  useEffect(() => {
    if (idleStopped || liveAutoplayTriedRef.current) return;
    if (!adapter.canPlay || !adapter.paused) return;
    liveAutoplayTriedRef.current = true;
    adapter.play();
  }, [adapter.canPlay, adapter.paused, adapter.play, idleStopped, sourceKey]);

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
        x-webkit-airplay="allow"
        preload="auto"
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
        isLive
      />
      {idleStopped ? <StillWatchingScreen onResume={resumeAfterIdle} /> : null}
    </div>
  );
}
