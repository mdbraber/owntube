"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useVideoCardActions } from "@/components/videos/use-video-card-actions";
import { VideoCardActionsPlaylistPanel } from "@/components/videos/video-card-actions-playlist-panel";
import { cn } from "@/lib/utils";

type VideoCardActionsMenuProps = {
  videoId: string;
  channelId?: string;
  channelName?: string;
  className?: string;
};

function MoreIcon() {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative; button has aria-label
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5"
      aria-hidden
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function menuItemClass(active = false) {
  return cn(
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
    active
      ? "bg-[hsl(var(--primary)_/_0.12)] text-[hsl(var(--primary))]"
      : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted)_/_0.65)]",
  );
}

export function VideoCardActionsMenu({
  videoId,
  channelId,
  channelName,
  className,
}: VideoCardActionsMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const actions = useVideoCardActions({
    videoId,
    channelId,
    channelName,
    loadPlaylists: open,
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        actions.closePanels();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        actions.closePanels();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, actions]);

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity duration-200 hover:bg-[hsl(var(--muted)_/_0.65)] hover:text-[hsl(var(--foreground))] group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        aria-label="Options de la vidéo"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-state={open ? "open" : "closed"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
          if (open) actions.closePanels();
        }}
      >
        <MoreIcon />
      </Button>
      {actions.feedback ? (
        <span className="pointer-events-none absolute top-full right-0 z-30 mt-1 max-w-[14rem] truncate rounded-md bg-[hsl(var(--foreground))] px-2 py-1 text-[11px] font-medium text-[hsl(var(--background))] shadow-md">
          {actions.feedback}
        </span>
      ) : null}
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute top-full right-0 z-40 mt-1 w-56 overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1 text-sm shadow-lg"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {actions.view === "main" ? (
            <ul>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass()}
                  disabled={actions.pending}
                  onClick={() => actions.setView("playlist")}
                >
                  <span className="flex-1">Ajouter à une playlist</span>
                  <span className="text-[hsl(var(--muted-foreground))]">›</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass(actions.liked)}
                  disabled={actions.pending}
                  onClick={() => void actions.toggleLike()}
                >
                  J&apos;aime
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass(actions.disliked)}
                  disabled={actions.pending}
                  onClick={() => void actions.toggleDislike()}
                >
                  J&apos;aime pas
                </button>
              </li>
              {channelId ? (
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItemClass(actions.channelBlocked)}
                    disabled={actions.pending || actions.channelBlocked}
                    onClick={() => void actions.blockRecommendationChannel()}
                  >
                    Ne pas recommander cette chaîne
                  </button>
                </li>
              ) : null}
            </ul>
          ) : (
            <VideoCardActionsPlaylistPanel
              view={actions.view}
              setView={actions.setView}
              playlists={actions.playlists}
              newPlaylistName={actions.newPlaylistName}
              setNewPlaylistName={actions.setNewPlaylistName}
              pending={actions.pending}
              onAddToPlaylist={(id) => void actions.addVideoToPlaylist(id)}
              onSubmitNewPlaylist={() => void actions.submitNewPlaylist()}
              className="border-0 bg-transparent shadow-none"
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
