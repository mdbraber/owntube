"use client";

import { useEffect, useRef } from "react";
import { usePlayerContext } from "@/components/player/player-context";
import type { VideoPlayerProps } from "@/components/player/video-player";
import { useWatchCinema } from "@/components/watch/watch-cinema-context";
import { cn } from "@/lib/utils";

type WatchPlayerMountProps = VideoPlayerProps & { isAuthed: boolean };

/**
 * Watch-page player anchor. Instead of rendering a <VideoPlayer> here (which
 * would be destroyed on navigation), it pushes the video into the shared
 * PlayerHost and leaves a placeholder slot for the host to position over. The
 * slot mirrors the player's sizing (incl. cinema) so the overlay lines up.
 */
export function WatchPlayerMount({
  isAuthed,
  ...playerProps
}: WatchPlayerMountProps) {
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
