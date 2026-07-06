"use client";

import { useVideoMembership } from "@/components/videos/video-membership-context";
import { cn } from "@/lib/utils";

type VideoStatusPillsProps = {
  videoId?: string;
  className?: string;
  /** Compact pill sizing for smaller cards (shorts/compact). */
  size?: "default" | "sm";
};

/**
 * Renders a "Playlist: X" pill for a video when it belongs to a playlist,
 * styled like the upcoming duration pill. Rendered inline so cards can place it
 * in the bottom-right row next to the duration badge. Reads shared membership
 * state from context, so any card can drop it in without wiring its own query.
 * Saved / queued state is surfaced by the corner action buttons instead.
 */
export function VideoStatusPills({
  videoId,
  className,
  size = "default",
}: VideoStatusPillsProps) {
  const { playlistName } = useVideoMembership(videoId);
  if (!playlistName) return null;

  const sizeClass =
    size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";

  return (
    <span
      className={cn(
        "pointer-events-none inline-flex min-w-0 items-center rounded-full bg-violet-600 font-semibold text-white shadow-sm",
        sizeClass,
        className,
      )}
      title={`Playlist: ${playlistName}`}
    >
      <span className="truncate">Playlist: {playlistName}</span>
    </span>
  );
}
