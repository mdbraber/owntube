"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  PlaylistIcon,
  QueuedIcon,
  SavedIcon,
} from "@/components/videos/video-action-icons";
import { useVideoMembership } from "@/components/videos/video-membership-context";
import { cn } from "@/lib/utils";

type VideoStatusPillsProps = {
  videoId?: string;
  className?: string;
  /** Compact pill sizing for smaller cards (shorts/compact). */
  size?: "default" | "sm";
  /** Suppress pills that restate the page (e.g. "Queued" on the queue page). */
  omit?: readonly ("queued" | "saved" | "playlist")[];
};

/**
 * State pills for a video thumbnail's bottom row: Queued, Saved, and playlist
 * membership (glyph + playlist name). State renders here — next to the
 * duration badge, in the metadata zone — never as a lingering overlay button.
 * Each pill navigates to its collection (queue / saved / that playlist), so
 * hosts must place this row *outside* any wrapping link. Reads shared
 * membership state from context, so any card can drop it in without wiring
 * its own query.
 */
export function VideoStatusPills({
  videoId,
  className,
  size = "default",
  omit = [],
}: VideoStatusPillsProps) {
  const router = useRouter();
  const membership = useVideoMembership(videoId);
  const queued = membership.queued && !omit.includes("queued");
  const saved = membership.saved && !omit.includes("saved");
  const playlistName = omit.includes("playlist")
    ? undefined
    : membership.playlistName;
  if (!saved && !queued && !playlistName) return null;

  const sizeClass =
    size === "sm"
      ? "gap-1 px-1.5 py-px text-[10px]"
      : "gap-1.5 px-2 py-0.5 text-[11px]";
  const iconClass = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  const pill = (
    label: string,
    icon: ReactNode,
    href: string,
    options?: { title?: string; className?: string },
  ) => (
    <button
      type="button"
      className={cn(
        "pointer-events-auto inline-flex min-w-0 cursor-pointer items-center rounded-full border border-white/15 bg-black/75 font-semibold text-white shadow-sm transition hover:bg-black/90",
        sizeClass,
        options?.className,
      )}
      title={options?.title ?? label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        router.push(href);
      }}
    >
      <span className={cn("shrink-0 text-[hsl(var(--primary))]", iconClass)}>
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      {queued
        ? pill("Queued", <QueuedIcon className={iconClass} />, "/queue", {
            title: "Queued — go to queue",
          })
        : null}
      {saved
        ? pill("Saved", <SavedIcon className={iconClass} />, "/saved", {
            title: "Saved — go to saved videos",
          })
        : null}
      {playlistName
        ? pill(
            playlistName,
            <PlaylistIcon className={iconClass} />,
            membership.playlistId != null
              ? `/playlists/${membership.playlistId}`
              : "/playlists",
            {
              title: `In playlist: ${playlistName} — open playlist`,
              className: "max-w-[9rem]",
            },
          )
        : null}
    </span>
  );
}
