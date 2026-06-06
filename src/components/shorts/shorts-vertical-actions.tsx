"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { VideoCardActionsPlaylistPanel } from "@/components/videos/video-card-actions-playlist-panel";
import { useVideoCardActions } from "@/components/videos/use-video-card-actions";
import { cn } from "@/lib/utils";

type ShortsVerticalActionsProps = {
  videoId: string;
  channelId?: string;
  channelName?: string;
  className?: string;
};

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

function PlaylistIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M4 6h16M4 12h10M4 18h6" />
      <path d="M17 10v8M13 14h8" />
    </svg>
  );
}

function LikeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.31l.95-4.57.03-.32a1 1 0 0 0-.29-.7L13.17 1 7.59 6.59A2 2 0 0 0 7 8v10a2 2 0 0 0 2 2h8a2 2 0 0 0 1.9-1.37l3-9c.07-.2.1-.41.1-.63V10z" />
    </svg>
  );
}

function DislikeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M22 3h-4v12h4V3zM2 14a2 2 0 0 0 2 2h6.31l-.95 4.57-.03.32c0 .26.11.52.29.7L10.83 23l5.58-5.59A2 2 0 0 0 17 16V6a2 2 0 0 0-2-2H7a2 2 0 0 0-1.9 1.37l-3 9c-.07.2-.1.41-.1.63z" />
    </svg>
  );
}

function BlockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M5 5l14 14" />
    </svg>
  );
}

export function ShortsVerticalActions({
  videoId,
  channelId,
  channelName,
  className,
}: ShortsVerticalActionsProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const actions = useVideoCardActions({
    videoId,
    channelId,
    channelName,
    loadPlaylists: true,
  });
  const { playlistOpen, closePanels, setView, setPlaylistOpen } = actions;

  useEffect(() => {
    if (!playlistOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        closePanels();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanels();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [playlistOpen, closePanels]);

  const openPlaylist = () => {
    setPlaylistOpen((open) => {
      if (open) {
        closePanels();
        return false;
      }
      setView("playlist");
      return true;
    });
  };

  return (
    <aside
      ref={rootRef}
      className={cn(
        "relative z-30 flex shrink-0 flex-col items-center gap-0.5 pb-4 pt-2",
        className,
      )}
      aria-label="Actions"
    >
      {actions.feedback ? (
        <span className="pointer-events-none absolute right-full top-2 z-40 mr-2 max-w-[11rem] truncate rounded-md bg-black/85 px-2 py-1 text-[11px] font-medium text-white shadow-md">
          {actions.feedback}
        </span>
      ) : null}

      <RailButton
        label="Playlist"
        active={actions.playlistOpen}
        disabled={actions.pending}
        onClick={openPlaylist}
      >
        <PlaylistIcon />
      </RailButton>

      <RailButton
        label={actions.liked ? "Liked" : "Like"}
        active={actions.liked}
        disabled={actions.pending}
        onClick={() => void actions.toggleLike()}
      >
        <LikeIcon />
      </RailButton>

      <RailButton
        label={actions.disliked ? "Disliked" : "Dislike"}
        active={actions.disliked}
        disabled={actions.pending}
        onClick={() => void actions.toggleDislike()}
      >
        <DislikeIcon />
      </RailButton>

      {channelId ? (
        <RailButton
          label="Hide"
          active={actions.channelBlocked}
          disabled={actions.pending || actions.channelBlocked}
          onClick={() => void actions.blockRecommendationChannel()}
        >
          <BlockIcon />
        </RailButton>
      ) : null}

      {actions.playlistOpen && actions.view !== "main" ? (
        <div
          id={panelId}
          className="absolute right-full top-0 z-40 mr-2"
          role="dialog"
          aria-label="Playlists"
        >
          <VideoCardActionsPlaylistPanel
            view={actions.view}
            setView={actions.setView}
            playlists={actions.playlists}
            newPlaylistName={actions.newPlaylistName}
            setNewPlaylistName={actions.setNewPlaylistName}
            pending={actions.pending}
            onAddToPlaylist={(id) => void actions.addVideoToPlaylist(id)}
            onSubmitNewPlaylist={() => void actions.submitNewPlaylist()}
          />
        </div>
      ) : null}
    </aside>
  );
}
