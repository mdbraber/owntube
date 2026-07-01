"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

function parseVideoId(input: string): string {
  const raw = input.trim();
  const direct = raw.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1];
  if (direct) return direct;
  const ytu = raw.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)?.[1];
  if (ytu) return ytu;
  const shorts = raw.match(/\/shorts\/([a-zA-Z0-9_-]{11})/)?.[1];
  if (shorts) return shorts;
  return raw;
}

export function PlaylistsPanel() {
  const utils = trpc.useUtils();
  const list = trpc.playlists.list.useQuery();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(
    null,
  );
  const [videoId, setVideoId] = useState("");
  const [channelId, setChannelId] = useState("");

  const create = trpc.playlists.create.useMutation({
    onSuccess: async () => {
      setName("");
      setDescription("");
      await utils.playlists.list.invalidate();
    },
  });
  const remove = trpc.playlists.remove.useMutation({
    onSuccess: async () => {
      await utils.playlists.list.invalidate();
      setSelectedPlaylistId(null);
    },
  });
  const items = trpc.playlists.items.useQuery(
    { playlistId: selectedPlaylistId ?? 0 },
    { enabled: selectedPlaylistId != null },
  );
  const addItem = trpc.playlists.addItem.useMutation({
    onSuccess: async () => {
      setVideoId("");
      setChannelId("");
      if (selectedPlaylistId != null) {
        await utils.playlists.items.invalidate({
          playlistId: selectedPlaylistId,
        });
      }
      await utils.playlists.list.invalidate();
    },
  });
  const removeItem = trpc.playlists.removeItem.useMutation({
    onSuccess: async () => {
      if (selectedPlaylistId != null) {
        await utils.playlists.items.invalidate({
          playlistId: selectedPlaylistId,
        });
      }
      await utils.playlists.list.invalidate();
    },
  });

  const activePlaylist =
    list.data?.find((p) => p.id === selectedPlaylistId) ?? null;

  useEffect(() => {
    if (selectedPlaylistId == null && list.data && list.data.length > 0) {
      setSelectedPlaylistId(list.data[0].id);
    }
  }, [list.data, selectedPlaylistId]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Create playlist</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="Playlist name"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            placeholder="Description (optional)"
          />
          <Button
            type="button"
            disabled={!name.trim() || create.isPending}
            onClick={() =>
              create.mutate({
                name: name.trim(),
                description: description.trim() || undefined,
              })
            }
          >
            Create
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your playlists</h2>
        {!list.data || list.data.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No playlists yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {list.data.map((p) => (
              <li
                key={p.id}
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  selectedPlaylistId === p.id
                    ? "border-[hsl(var(--primary))] bg-[hsl(var(--accent))]"
                    : "",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => setSelectedPlaylistId(p.id)}
                  >
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      {p.description || "No description"} · {p.itemCount} items
                    </p>
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate({ playlistId: p.id })}
                    disabled={remove.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedPlaylistId != null ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            {activePlaylist?.name ?? "Playlist"} items
          </h2>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              value={videoId}
              onChange={(e) => setVideoId(e.currentTarget.value)}
              placeholder="Video ID or YouTube URL"
            />
            <Input
              value={channelId}
              onChange={(e) => setChannelId(e.currentTarget.value)}
              placeholder="Channel ID (optional)"
            />
            <Button
              type="button"
              disabled={!videoId.trim() || addItem.isPending}
              onClick={() =>
                addItem.mutate({
                  playlistId: selectedPlaylistId,
                  videoId: parseVideoId(videoId),
                  channelId: channelId.trim() || undefined,
                })
              }
            >
              Add
            </Button>
          </div>
          {items.data ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {items.data.items.length} item(s)
            </p>
          ) : null}
          <ul className="space-y-2">
            {(items.data?.items ?? []).map((i) => (
              <li
                key={`${i.id}-${i.videoId}`}
                className="rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={`/watch/${encodeURIComponent(i.videoId)}`}
                    className="font-mono text-sm text-[hsl(var(--primary))] hover:underline"
                  >
                    {i.videoId}
                  </a>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={removeItem.isPending}
                    onClick={() =>
                      removeItem.mutate({
                        playlistId: selectedPlaylistId,
                        videoId: i.videoId,
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
