"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePlayerContext } from "@/components/player/player-context";
import type { VideoPlayerProps } from "@/components/player/video-player";
import { useWatchCinema } from "@/components/watch/watch-cinema-context";
import { postToNativeApp } from "@/lib/native-app";
import { cn } from "@/lib/utils";

type WatchPlayerMountProps = VideoPlayerProps & {
  isAuthed: boolean;
  /** Inside the iOS app: the native player plays, not the web one. */
  nativeApp?: boolean;
  /**
   * Inside the iOS app's player panel (`?panel=1`), below its native video:
   * no player area at all, only the video reported to the app.
   */
  nativePanel?: boolean;
  /** For the native player's Now Playing info. */
  channelName?: string;
};

/**
 * Inside the iOS app, the native player (AVPlayer: Picture-in-Picture,
 * background audio, lock screen controls) plays the video. The page reports
 * its video on arrival. In the app's player panel that's all; anywhere else
 * (rare: the app opens videos in the panel) it leaves the poster in the
 * player's place, and tapping it opens the panel.
 */
function NativeAppPlayerSlot({
  videoId,
  title,
  channelName,
  poster,
  startAtSeconds,
  durationSeconds,
  isLive,
  autoplayOnWatch,
  panel = false,
}: { panel?: boolean } & Pick<
  WatchPlayerMountProps,
  | "videoId"
  | "title"
  | "channelName"
  | "poster"
  | "startAtSeconds"
  | "durationSeconds"
  | "isLive"
  | "autoplayOnWatch"
>) {
  const play = useCallback(
    (autoplay: boolean) =>
      postToNativeApp({
        type: "play",
        video: {
          videoId,
          title,
          channelName,
          poster,
          startSeconds: startAtSeconds,
          durationSeconds,
          isLive,
          autoplay,
        },
      }),
    [
      videoId,
      title,
      channelName,
      poster,
      startAtSeconds,
      durationSeconds,
      isLive,
    ],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per video; the other props describe the same video.
  useEffect(() => {
    play(autoplayOnWatch ?? true);
  }, [videoId]);

  // In the panel the app already plays the video above this page; the report
  // gives it the title, artwork and resume position.
  if (panel) return null;

  return (
    <button
      type="button"
      onClick={() => play(true)}
      aria-label={`Play ${title}`}
      className="relative mx-[-16px] block aspect-video w-[calc(100%_+_2rem)] overflow-hidden bg-black bg-contain bg-center bg-no-repeat sm:mx-0 sm:w-full sm:rounded-[var(--radius-card)]"
      style={poster ? { backgroundImage: `url(${poster})` } : undefined}
    >
      <span className="absolute inset-0 flex items-center justify-center bg-black/25">
        <svg
          width="56"
          height="56"
          viewBox="0 0 56 56"
          aria-hidden
          className="drop-shadow-lg"
        >
          <title>Play</title>
          <circle cx="28" cy="28" r="28" fill="rgb(0 0 0 / 0.55)" />
          <path d="M22 17.5v21l17-10.5z" fill="white" />
        </svg>
      </span>
    </button>
  );
}

/**
 * Watch-page player anchor. Instead of rendering a <VideoPlayer> here (which
 * would be destroyed on navigation), it pushes the video into the shared
 * PlayerHost and leaves a placeholder slot for the host to position over. The
 * slot mirrors the player's sizing (incl. cinema) so the overlay lines up.
 */
export function WatchPlayerMount({
  nativeApp = false,
  nativePanel = false,
  ...props
}: WatchPlayerMountProps) {
  return nativeApp ? (
    <NativeAppPlayerSlot {...props} panel={nativePanel} />
  ) : (
    <WebPlayerMount {...props} />
  );
}

function WebPlayerMount({
  isAuthed,
  channelName: _channelName,
  nativePanel: _nativePanel,
  ...playerProps
}: Omit<WatchPlayerMountProps, "nativeApp">) {
  const { setActive, registerSlot } = usePlayerContext();
  const cinema = useWatchCinema();
  const slotRef = useRef<HTMLDivElement | null>(null);
  // Server props are stable per navigation; keep the latest in a ref so the
  // activation effect only re-runs on a new video or a cinema-handle change.
  const propsRef = useRef(playerProps);
  propsRef.current = playerProps;

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-activate on new videoId/cinema; latest props come from the ref.
  useEffect(() => {
    setActive({
      isAuthed,
      props: { ...propsRef.current, cinema: cinema ?? null },
    });
  }, [setActive, isAuthed, cinema, playerProps.videoId]);

  useEffect(() => {
    registerSlot(slotRef.current);
    return () => registerSlot(null);
  }, [registerSlot]);

  const cinemaMode = Boolean(cinema?.cinemaMode);
  const poster = playerProps.poster;

  return (
    <div
      ref={slotRef}
      className={cn(
        // Poster uses contain (not cover) to match the <video>'s object-contain
        // framing, so the placeholder doesn't show a cropped/zoomed poster that
        // then "scales back" once the player overlays it.
        // The persistent player overlay is positioned to THIS slot's rect, so
        // going full-bleed here (phones, <sm) is what makes the watch video sit
        // edge-to-edge; square corners on mobile, framed/rounded on sm+.
        "relative overflow-hidden bg-black bg-contain bg-center bg-no-repeat sm:rounded-[var(--radius-card)]",
        // Phones (<sm): edge-to-edge regardless of cinema mode — break out of the
        // page's 16px side padding, square corners.
        "aspect-video mx-[-16px] w-[calc(100%_+_2rem)]",
        // Tablet/desktop (sm+): framed; cinema centers and caps height.
        cinemaMode
          ? "sm:mx-auto sm:w-full sm:max-h-[min(88vh,92dvh)]"
          : "sm:mx-0 sm:w-full",
      )}
      style={poster ? { backgroundImage: `url(${poster})` } : undefined}
      aria-hidden
    />
  );
}
