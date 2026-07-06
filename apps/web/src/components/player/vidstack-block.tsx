"use client";

import {
  MediaOutlet,
  MediaPlayer,
  useMediaRemote,
  useMediaStore,
} from "@vidstack/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaPlayerElement, MediaProvider } from "vidstack";
import { HlsSameOriginBinder } from "@/components/player/hls-same-origin-binder";
import { LiveHlsDirectBlock } from "@/components/player/live-block";
import { useVidstackAdapter } from "@/components/player/player-adapters";
import { PlayerChrome } from "@/components/player/player-chrome";
import {
  PLAYER_FILL,
  SHORTS_SHELL_POINTER,
} from "@/components/player/player-constants";
import { useMiniPlayerMediaBootstrap } from "@/components/player/player-media-hooks";
import {
  type QualityModel,
  useHlsAudioModel,
  useHlsQualityModel,
  withProgressiveQualitySetter,
} from "@/components/player/player-quality";
import type { VidstackBlockProps } from "@/components/player/player-types";
import { applyHlsSameOriginToVidstackProvider } from "@/lib/hls-same-origin";
import { sourceFromUrl } from "@/lib/media-source-from-url";
import {
  readPlayerMediaPrefs,
  writePlayerMediaPrefs,
} from "@/lib/player-media-prefs";
import { cn } from "@/lib/utils";

/**
 * Subscribes to Vidstack store only after MediaPlayer has mounted — avoids
 * "Cannot update VidstackBlock while rendering MediaPlayer" (setState in render).
 */
function VidstackPlayerChrome({
  playerRef,
  shellRef,
  src,
  title,
  poster,
  reactKey,
  setQualityIndex,
  progressiveQualityMenu,
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
  scrubPreview,
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
  isLive = false,
}: VidstackBlockProps & {
  playerRef: React.RefObject<MediaPlayerElement | null>;
  shellRef: React.RefObject<HTMLDivElement | null>;
}) {
  const adapter = useVidstackAdapter(playerRef);
  const remote = useMediaRemote(
    playerRef as React.RefObject<EventTarget | null>,
  );
  const persistStore = useMediaStore(
    playerRef as React.RefObject<EventTarget | null>,
  );
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlsQuality = useHlsQualityModel(playerRef);
  const hlsAudio = useHlsAudioModel(playerRef);
  const initialSeekAppliedRef = useRef(false);
  const initialMediaPrefsAppliedRef = useRef(false);
  const miniAutoplayDoneRef = useRef(false);
  const miniShouldAutoplay = miniMode && !miniStartPaused;

  useMiniPlayerMediaBootstrap(
    adapter,
    miniMode,
    shortsMode,
    restoredVolume,
    restoredMuted,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey/startAtSeconds reset the one-shot initial seek latch for a new source.
  useEffect(() => {
    initialSeekAppliedRef.current = false;
  }, [reactKey, startAtSeconds]);

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
    const id = window.setTimeout(() => {
      remote.seek(startAtSeconds);
      initialSeekAppliedRef.current = true;
    }, 0);
    return () => window.clearTimeout(id);
  }, [adapter.canPlay, remote, startAtSeconds]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey lets source swaps retry shorts/mini autoplay even when adapter booleans match.
  useEffect(() => {
    if (shortsMode) {
      if (!adapter.canPlay || !adapter.paused) return;
      const id = window.setTimeout(() => {
        if (adapter.paused) remote.play();
      }, 0);
      return () => window.clearTimeout(id);
    }
    if (!miniShouldAutoplay) return;
    if (miniAutoplayDoneRef.current) return;
    if (!adapter.canPlay || !adapter.paused) return;
    miniAutoplayDoneRef.current = true;
    const id = window.setTimeout(() => {
      if (adapter.paused) remote.play();
    }, 0);
    return () => window.clearTimeout(id);
  }, [
    adapter.canPlay,
    adapter.paused,
    miniShouldAutoplay,
    remote,
    shortsMode,
    reactKey,
  ]);

  useEffect(() => {
    if (!persistStore.canPlay) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      writePlayerMediaPrefs({
        volume: adapter.volume,
        muted: persistStore.muted,
      });
    }, 200);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [persistStore.muted, persistStore.canPlay, adapter.volume]);

  const [mediaPrefs, setMediaPrefs] = useState({ volume: 1, muted: false });
  useEffect(() => {
    setMediaPrefs(readPlayerMediaPrefs());
  }, []);

  useEffect(() => {
    if (initialMediaPrefsAppliedRef.current) return;
    if (!persistStore.canPlay) return;
    if (shortsMode) {
      const id = window.setTimeout(() => {
        remote.mute();
        initialMediaPrefsAppliedRef.current = true;
      }, 0);
      return () => window.clearTimeout(id);
    }
    if (miniMode) {
      initialMediaPrefsAppliedRef.current = true;
      return;
    }
    const vol =
      typeof mediaPrefs.volume === "number" &&
      Number.isFinite(mediaPrefs.volume)
        ? Math.min(1, Math.max(0, mediaPrefs.volume))
        : 1;
    const id = window.setTimeout(() => {
      adapter.setVolume(vol);
      if (mediaPrefs.muted || vol <= 0.001) remote.mute();
      else remote.unmute();
      initialMediaPrefsAppliedRef.current = true;
    }, 0);
    return () => window.clearTimeout(id);
  }, [adapter, mediaPrefs, persistStore.canPlay, remote, shortsMode, miniMode]);

  const quality: QualityModel = progressiveQualityMenu
    ? withProgressiveQualitySetter(
        progressiveQualityMenu,
        setQualityIndex,
        adapter.currentTime,
      )
    : hlsQuality;

  return (
    <PlayerChrome
      adapter={adapter}
      shellRef={shellRef}
      title={title}
      chapters={chapters}
      videoId={videoId}
      sponsorSegments={sponsorSegments}
      sponsorBlockPrefs={sponsorBlockPrefs}
      quality={quality}
      audio={hlsAudio}
      settingsOpen={settingsOpen}
      onSettingsOpenChange={onSettingsOpenChange}
      cinemaMode={cinemaMode}
      onExitCinema={onExitCinema}
      onToggleCinema={onToggleCinema}
      scrubPreview={
        isLive
          ? null
          : (scrubPreview ?? { streamSrc: src, ...(poster ? { poster } : {}) })
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
  );
}

/**
 * Branch component: live and VOD render entirely different hook trees, so each
 * lives in its own component — an early return above hooks would crash React
 * if `isLive` ever flipped on a mounted instance.
 */
export function VidstackBlock(props: VidstackBlockProps) {
  if (props.isLive) {
    return <LiveHlsDirectBlock {...props} />;
  }
  return <VodVidstackBlock {...props} />;
}

function VodVidstackBlock(props: VidstackBlockProps) {
  const {
    src,
    title,
    poster,
    reactKey,
    onPlaybackError,
    onEnded,
    cinemaMode,
    shortsMode = false,
    miniMode = false,
    miniStartPaused = false,
    autoplay = false,
  } = props;
  const miniShouldAutoplay = miniMode && !miniStartPaused;
  const playerRef = useRef<MediaPlayerElement | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [chromeReady, setChromeReady] = useState(false);

  const emitPlaybackError = useCallback(() => {
    if (!onPlaybackError) return;
    window.setTimeout(() => onPlaybackError(), 0);
  }, [onPlaybackError]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey delays chrome until the remounted media element exists.
  useEffect(() => {
    setChromeReady(false);
    const id = requestAnimationFrame(() => setChromeReady(true));
    return () => cancelAnimationFrame(id);
  }, [reactKey]);

  const onVideoIntrinsics = props.onVideoIntrinsics;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reactKey rebinds metadata listeners after the Vidstack media element remounts.
  useEffect(() => {
    if (!onVideoIntrinsics) return;
    const video = shellRef.current?.querySelector("video");
    if (!video) return;
    const report = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onVideoIntrinsics(video.videoWidth, video.videoHeight);
      }
    };
    video.addEventListener("loadedmetadata", report);
    report();
    return () => video.removeEventListener("loadedmetadata", report);
  }, [onVideoIntrinsics, reactKey]);

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
      <MediaPlayer
        key={reactKey}
        ref={playerRef}
        title={title}
        src={sourceFromUrl(src)}
        poster={poster}
        controls={false}
        load="eager"
        preferNativeHLS={false}
        playsInline
        autoPlay={shortsMode || miniShouldAutoplay || autoplay}
        muted={shortsMode}
        onProviderChange={(event: CustomEvent<MediaProvider | null>) =>
          applyHlsSameOriginToVidstackProvider(event.detail)
        }
        onError={emitPlaybackError}
        onEnded={onEnded}
        className={cn(
          "absolute inset-0",
          shortsMode
            ? "h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain [&_vds-poster]:hidden"
            : PLAYER_FILL,
        )}
      >
        <HlsSameOriginBinder />
        <MediaOutlet />
      </MediaPlayer>
      {chromeReady ? (
        <VidstackPlayerChrome
          {...props}
          playerRef={playerRef}
          shellRef={shellRef}
        />
      ) : null}
    </div>
  );
}
