"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VideoCardActionsView } from "@/components/videos/use-video-card-actions";
import { cn } from "@/lib/utils";

function menuItemClass(active = false) {
  return cn(
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
    active
      ? "bg-[hsl(var(--primary)_/_0.12)] text-[hsl(var(--primary))]"
      : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted)_/_0.65)]",
  );
}

type VideoCardActionsPlaylistPanelProps = {
  view: VideoCardActionsView;
  setView: (view: VideoCardActionsView) => void;
  playlists: {
    isLoading: boolean;
    data?: { id: number; name: string; itemCount: number }[];
  };
  newPlaylistName: string;
  setNewPlaylistName: (name: string) => void;
  pending: boolean;
  onAddToPlaylist: (playlistId: number) => void;
  onSubmitNewPlaylist: () => void;
  className?: string;
};

export function VideoCardActionsPlaylistPanel({
  view,
  setView,
  playlists,
  newPlaylistName,
  setNewPlaylistName,
  pending,
  onAddToPlaylist,
  onSubmitNewPlaylist,
  className,
}: VideoCardActionsPlaylistPanelProps) {
  return (
    <div
      className={cn(
        "w-56 overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1 text-sm shadow-lg",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {view === "playlist" ? (
        <div>
          <button
            type="button"
            className={cn(
              menuItemClass(),
              "text-[hsl(var(--muted-foreground))]",
            )}
            onClick={() => setView("main")}
          >
            ‹ Retour
          </button>
          <ul className="max-h-48 overflow-y-auto border-t border-[hsl(var(--border))]">
            {playlists.isLoading ? (
              <li className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                Chargement…
              </li>
            ) : null}
            {playlists.data?.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={menuItemClass()}
                  disabled={pending}
                  onClick={() => onAddToPlaylist(p.id)}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-xs text-[hsl(var(--muted-foreground))]">
                    {p.itemCount}
                  </span>
                </button>
              </li>
            ))}
            {!playlists.isLoading &&
            playlists.data &&
            playlists.data.length === 0 ? (
              <li className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                Aucune playlist
              </li>
            ) : null}
          </ul>
          <button
            type="button"
            className={cn(
              menuItemClass(),
              "border-t border-[hsl(var(--border))] font-medium",
            )}
            onClick={() => setView("create-playlist")}
          >
            Créer une playlist…
          </button>
        </div>
      ) : null}
      {view === "create-playlist" ? (
        <div className="space-y-2 p-2">
          <button
            type="button"
            className={cn(
              menuItemClass(),
              "text-[hsl(var(--muted-foreground))]",
            )}
            onClick={() => setView("playlist")}
          >
            ‹ Retour
          </button>
          <Input
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.currentTarget.value)}
            placeholder="Nom de la playlist"
            maxLength={120}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmitNewPlaylist();
            }}
          />
          <Button
            type="button"
            className="w-full"
            size="sm"
            disabled={!newPlaylistName.trim() || pending}
            onClick={onSubmitNewPlaylist}
          >
            Créer et ajouter
          </Button>
        </div>
      ) : null}
    </div>
  );
}
