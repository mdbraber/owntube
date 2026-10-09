"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNativeAdapter } from "@/components/player/player-adapters";
import { usePlayerCaptions } from "@/components/player/player-captions";
import { PlayerChrome } from "@/components/player/player-chrome";
import { useReportVideoIntrinsics } from "@/components/player/player-media-hooks";
import { dashQualityModel } from "@/components/player/player-quality";
import type { HlsBlockProps } from "@/components/player/player-types";
import { useDashPlayback } from "@/hooks/use-dash-playback";
import {
  readPlayerMediaPrefs,
  writePlayerVolumeOnly,
} from "@/lib/player-media-prefs";
import { cn } from "@/lib/utils";

/**
 * A live broadcast: OwnTube's live DASH manifest (`/dash/<id>/live.mpd`, see
 * `live-manifest.ts`) on dash.js, with the same quality menu as VOD DASH.
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
  defaultQualityHeightCap,
}: HlsBlockProps & {
  /** DASH ABR ceiling — null means uncapped. */
  defaultQualityHeightCap?: number | null;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [volume, setVolume] = useState(() => readPlayerMediaPrefs().volume);

  const emitPlaybackError = useCallback(() => {
    if (!onPlaybackError) return;
    window.setTimeout(() => onPlaybackError(), 0);
  }, [onPlaybackError]);

  // Autoplay is the effect below; no start time, so dash.js joins at the live
  // edge.
  const dash = useDashPlayback(
    videoRef,
    src,
    reactKey,
    undefined,
    false,
    emitPlaybackError,
    defaultQualityHeightCap,
  );
  const quality = useMemo(() => dashQualityModel(dash), [dash]);

  const adapter = useNativeAdapter({
    videoRef,
    audioRef,
    externalVolume: volume,
    setExternalVolume: setVolume,
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
      {/* biome-ignore lint/a11y/useMediaCaption: subtitle <track>s are provided dynamically from the `captions` prop (mapped children the rule can't statically see). */}
      <video
        key={reactKey}
        ref={videoRef}
        poster={poster}
        playsInline
        preload="auto"
        x-webkit-airplay="allow"
        // src + caption <track>s are on the media origin (media-origin.ts);
        // cross-origin <track> loading requires this. No credentials needed.
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
        quality={quality}
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
    </div>
  );
}
