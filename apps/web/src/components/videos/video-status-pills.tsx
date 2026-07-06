"use client";

import { useVideoMembership } from "@/components/videos/video-membership-context";
import { cn } from "@/lib/utils";

type VideoStatusPillsProps = {
  videoId?: string;
  /** Position/wrapper classes for the pill stack (defaults to top-right overlay). */
  className?: string;
  /** Compact pill sizing for smaller cards (shorts/compact). */
  size?: "default" | "sm";
};

const pillBase =
  "pointer-events-none inline-flex max-w-full items-center gap-1 rounded-full font-semibold text-white shadow-sm";

/**
 * Renders "Saved" / "Queued" / "Playlist: X" pills for a video, styled like the
 * upcoming duration pill. Reads shared membership state from context, so any
 * card can drop this in without wiring its own queries. Renders nothing when the
 * video has no membership (or the user is signed out).
 */
export function VideoStatusPills({
  videoId,
  className,
  size = "default",
}: VideoStatusPillsProps) {
  const { saved, queued, playlistName } = useVideoMembership(videoId);
  if (!saved && !queued && !playlistName) return null;

  const sizeClass =
    size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";

  return (
    <div
      className={cn(
        "pointer-events-none absolute right-2 top-2 z-10 flex flex-wrap justify-end gap-1",
        size === "sm" && "right-1.5 top-1.5",
        className,
      )}
    >
      {saved ? (
        <span className={cn(pillBase, sizeClass, "bg-emerald-600")}>Saved</span>
      ) : null}
      {queued ? (
        <span className={cn(pillBase, sizeClass, "bg-sky-600")}>Queued</span>
      ) : null}
      {playlistName ? (
        <span
          className={cn(pillBase, sizeClass, "bg-violet-600")}
          title={`Playlist: ${playlistName}`}
        >
          <span className="truncate">Playlist: {playlistName}</span>
        </span>
      ) : null}
    </div>
  );
}
