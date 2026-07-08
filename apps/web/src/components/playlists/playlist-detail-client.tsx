"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlaylistFormModal } from "@/components/playlists/playlist-form-modal";
import { PlaylistTags } from "@/components/playlists/playlist-tags";
import {
  type DraggableRowItem,
  DraggableVideoRows,
} from "@/components/videos/draggable-video-rows";
import { trpc } from "@/trpc/react";

/**
 * A playlist's own page, channel-style: a brand-colored header with name,
 * description, count, editable tags and an Edit button, then the items as
 * the shared reorderable row list.
 */
export function PlaylistDetailClient({ playlistId }: { playlistId: number }) {
  const utils = trpc.useUtils();
  const detailQuery = trpc.playlists.detail.useQuery({ playlistId });
  const itemsQuery = trpc.playlists.itemsDetailed.useQuery({ playlistId });

  const invalidate = () =>
    Promise.all([
      utils.playlists.itemsDetailed.invalidate({ playlistId }),
      utils.playlists.detail.invalidate({ playlistId }),
      utils.playlists.list.invalidate(),
      utils.playlists.membership.invalidate(),
    ]);
  const reorder = trpc.playlists.reorderItems.useMutation({
    onSettled: invalidate,
  });
  const removeItem = trpc.playlists.removeItem.useMutation({
    onSettled: invalidate,
  });

  const [items, setItems] = useState<DraggableRowItem[]>([]);
  useEffect(() => {
    if (itemsQuery.data) setItems(itemsQuery.data);
  }, [itemsQuery.data]);

  const [editOpen, setEditOpen] = useState(false);
  const detail = detailQuery.data;

  if (detailQuery.isLoading) {
    return (
      <p className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Loading…
      </p>
    );
  }
  if (!detail) {
    return (
      <div className="space-y-3 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        <p>This playlist does not exist (or was deleted).</p>
        <Link
          href="/playlists"
          className="font-medium text-[hsl(var(--primary))] underline-offset-4 hover:underline"
        >
          Back to playlists
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Channel-style header on the standard playlist background (brand). */}
      <header className="relative overflow-hidden rounded-2xl bg-[hsl(var(--primary))] px-6 py-7 text-white sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/12 via-transparent to-black/25"
        />
        <div className="relative space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-white/70">
            <Link href="/playlists" className="hover:text-white">
              Playlists
            </Link>{" "}
            · {detail.itemCount} {detail.itemCount === 1 ? "video" : "videos"}
          </p>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="m-0 max-w-2xl text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
              {detail.name}
            </h1>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="shrink-0 rounded-full border border-white/25 bg-black/20 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-black/35"
            >
              Edit
            </button>
          </div>
          {detail.description ? (
            <p className="m-0 max-w-2xl whitespace-pre-line text-sm text-white/85">
              {detail.description}
            </p>
          ) : null}
          <PlaylistTags playlistId={playlistId} tone="dark" />
        </div>
      </header>

      {!itemsQuery.isLoading && items.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No videos yet — use <strong>Add to playlist</strong> on any video.
        </p>
      ) : (
        <DraggableVideoRows
          items={items}
          surface="playlist"
          removeLabel="Remove from playlist"
          removeDisabled={removeItem.isPending}
          onMove={(from, to) =>
            setItems((arr) => {
              const next = [...arr];
              const [m] = next.splice(from, 1);
              next.splice(to, 0, m);
              return next;
            })
          }
          onDrop={() => {
            setItems((current) => {
              reorder.mutate({
                playlistId,
                videoIds: current.map((i) => i.videoId),
              });
              return current;
            });
          }}
          onRemove={(videoId) => {
            setItems((arr) => arr.filter((x) => x.videoId !== videoId));
            removeItem.mutate({ playlistId, videoId });
          }}
        />
      )}

      <PlaylistFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        playlist={{
          id: detail.id,
          name: detail.name,
          description: detail.description,
        }}
      />
    </div>
  );
}
