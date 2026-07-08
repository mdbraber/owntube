"use client";

import Link from "next/link";
import { useState } from "react";
import { PlaylistFormModal } from "@/components/playlists/playlist-form-modal";
import { Button } from "@/components/ui/button";
import { PlaylistIcon } from "@/components/videos/video-action-icons";
import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";
import { trpc } from "@/trpc/react";

/**
 * Playlists overview: one row per playlist in the shared row language — a
 * video-row-sized frame with a 2×2 collage of the first four items and count
 * badge, then name, description, and tags. "New playlist" opens the shared
 * form modal.
 */
export function PlaylistsOverview() {
  const listQuery = trpc.playlists.list.useQuery();
  const [createOpen, setCreateOpen] = useState(false);
  const playlists = listQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          New playlist
        </Button>
      </div>

      {!listQuery.isLoading && playlists.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No playlists yet — create one, or use <strong>Add to playlist</strong>{" "}
          on any video.
        </p>
      ) : (
        <ul className="space-y-1">
          {playlists.map((p) => (
            <li key={p.id}>
              <Link
                href={`/playlists/${p.id}`}
                className="group flex items-center gap-3 rounded-[var(--radius-card)] p-2 transition hover:bg-[hsl(var(--muted)_/_0.45)]"
              >
                {/* Video-row-sized frame with a 2×2 collage of items 1–4. */}
                <div className="relative aspect-video w-[12.75rem] shrink-0 overflow-hidden rounded-xl bg-[hsl(var(--muted))] sm:w-60">
                  {p.previewVideoIds.length > 0 ? (
                    <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px">
                      {[0, 1, 2, 3].map((slot) => {
                        const videoId = p.previewVideoIds[slot];
                        return videoId ? (
                          <VideoThumbnailImg
                            key={videoId}
                            videoId={videoId}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span
                            key={`empty-${slot}`}
                            className="block h-full w-full bg-[hsl(var(--muted))]"
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[hsl(var(--muted-foreground))]">
                      <PlaylistIcon className="h-8 w-8" />
                    </div>
                  )}
                  <span className="absolute bottom-1 right-1 z-10 rounded-md bg-black/78 px-1.5 py-px font-mono text-[10px] font-semibold text-white">
                    {p.itemCount} {p.itemCount === 1 ? "video" : "videos"}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="m-0 line-clamp-1 text-[15px] font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]">
                    {p.name}
                  </p>
                  {p.description ? (
                    <p className="mt-0.5 line-clamp-2 text-xs text-[hsl(var(--muted-foreground))]">
                      {p.description}
                    </p>
                  ) : null}
                  {p.tags.length > 0 ? (
                    <p className="mt-1 line-clamp-1 text-xs text-[hsl(var(--muted-foreground))]">
                      {p.tags.map((tag) => `#${tag}`).join("  ")}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <PlaylistFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
