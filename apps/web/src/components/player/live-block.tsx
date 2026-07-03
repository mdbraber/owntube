"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNativeAdapter } from "@/components/player/player-adapters";
import { PlayerChrome } from "@/components/player/player-chrome";
import { useReportVideoIntrinsics } from "@/components/player/player-media-hooks";
import type { VidstackBlockProps } from "@/components/player/player-types";
import { useLiveHlsPlayback } from "@/hooks/use-live-hls-playback";
import {
  readPlayerMediaPrefs,
  writePlayerVolumeOnly,
} from "@/lib/player-media-prefs";
import { cn } from "@/lib/utils";

/**
 * Live streams on Firefox may use native `<video>` HLS when Vidstack's MSE check
 * fails, which skips our segment proxy. Force hls.js with same-origin loaders.
 */
export function LiveHlsDirectBlock({
  src,
  poster,
  title,
  reactKey,
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
}: VidstackBlockProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [volume, setVolume] = useState(() => readPlayerMediaPrefs().volume);

  const emitPlaybackError = useCallback(() => {
    if (!onPlaybackError) return;
    window.setTimeout(() => onPlaybackError(), 0);
  }, [onPlaybackError]);

  useLiveHlsPlayback(videoRef, src, reactKey, emitPlaybackError);

  const adapter = useNativeAdapter({
    videoRef,
    audioRef,
    externalVolume: volume,
    setExternalVolume: setVolume,
  });

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey resets live autoplay once per broadcast source.
  useEffect(() => {
    liveAutoplayTriedRef.current = false;
  }, [reactKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey retries live autoplay after a source remount.
  useEffect(() => {
    if (liveAutoplayTriedRef.current) return;
    if (!adapter.canPlay || !adapter.paused) return;
    liveAutoplayTriedRef.current = true;
    adapter.play();
  }, [adapter.canPlay, adapter.paused, adapter.play, reactKey]);

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
      {/* biome-ignore lint/a11y/useMediaCaption: upstream live HLS captions are not exposed as local text tracks here. */}
      <video
        key={reactKey}
        ref={videoRef}
        poster={poster}
        playsInline
        preload="auto"
        onError={emitPlaybackError}
        onEnded={onEnded}
        className="absolute inset-0 h-full w-full object-contain"
      />
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
        isLive
      />
    </div>
  );
}
