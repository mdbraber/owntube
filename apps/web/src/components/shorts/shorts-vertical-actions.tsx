"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useVideoActions } from "@/components/videos/use-video-actions";
import {
  isVideoActionActive,
  type VideoActionId,
  VideoActionGlyph,
  videoActionShortLabel,
} from "@/components/videos/video-action-registry";
import { PlaylistPicker } from "@/components/videos/video-actions-menu";
import { cn } from "@/lib/utils";

type ShortsVerticalActionsProps = {
  videoId: string;
  channelId?: string;
  channelName?: string;
  title?: string;
  className?: string;
};

/** Verbs on the shorts rail, top to bottom (TikTok-style vertical stack). */
const RAIL_ACTIONS: Exclude<VideoActionId, "playlist">[] = [
  "like",
  "dislike",
  "block-channel",
];

function RailButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-[3.25rem] flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] font-medium leading-tight text-white/90 transition",
        "hover:bg-white/10 disabled:opacity-40",
        active && "text-[hsl(var(--primary))]",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full bg-white/10",
          active && "bg-[hsl(var(--primary)_/_0.25)]",
        )}
      >
        {children}
      </span>
      <span className="max-w-full text-center">{label}</span>
    </button>
  );
}

/**
 * Vertical action rail on the shorts player, rendered from the shared action
 * registry (same verbs, icons, and active treatment as cards and menus).
 */
export function ShortsVerticalActions({
  videoId,
  channelId,
  channelName,
  title,
  className,
}: ShortsVerticalActionsProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  const actions = useVideoActions({
    videoId,
    channelId,
    channelName,
    title,
    surface: "shorts",
    withInteractionState: true,
    loadPlaylists: playlistOpen,
  });

  useEffect(() => {
    if (!playlistOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setPlaylistOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlaylistOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [playlistOpen]);

  return (
    <aside
      ref={rootRef}
      className={cn(
        "relative z-30 flex shrink-0 flex-col items-center gap-0.5 pb-4 pt-2",
        className,
      )}
      aria-label="Actions"
    >
      <RailButton
        label="Playlist"
        active={playlistOpen}
        disabled={actions.pending}
        onClick={() => setPlaylistOpen((open) => !open)}
      >
        <VideoActionGlyph id="playlist" className="h-5 w-5" />
      </RailButton>

      {RAIL_ACTIONS.map((id) => {
        if (id === "block-channel" && !channelId) return null;
        const active = isVideoActionActive(id, actions.state);
        return (
          <RailButton
            key={id}
            label={videoActionShortLabel(id, actions.state)}
            active={active}
            disabled={
              actions.pending ||
              (id === "block-channel" && actions.state.channelBlocked)
            }
            onClick={() => actions.runAction(id)}
          >
            <VideoActionGlyph id={id} active={active} className="h-5 w-5" />
          </RailButton>
        );
      })}

      {playlistOpen ? (
        <div
          id={panelId}
          className="absolute right-full top-0 z-40 mr-2 w-60 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] pt-2 shadow-lg"
          role="dialog"
          aria-label="Playlists"
        >
          <PlaylistPicker
            actions={actions}
            onBack={() => setPlaylistOpen(false)}
            includeSaved
            title="Save to"
          />
        </div>
      ) : null}
    </aside>
  );
}
