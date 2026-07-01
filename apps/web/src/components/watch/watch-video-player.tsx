"use client";

import type { ComponentProps } from "react";
import { VideoPlayer } from "@/components/player/video-player";

type WatchVideoPlayerProps = ComponentProps<typeof VideoPlayer> & {
  isAuthed: boolean;
};

export function WatchVideoPlayer({
  isAuthed,
  ...props
}: WatchVideoPlayerProps) {
  return <VideoPlayer persistMiniSnapshot={isAuthed} {...props} />;
}
