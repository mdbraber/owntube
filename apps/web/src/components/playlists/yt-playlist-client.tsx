"use client";

import Link from "next/link";
import { VideoGrid } from "@/components/videos/video-grid";
import { trpc } from "@/trpc/react";

/**
 * A public YouTube playlist: muted header (name, channel link, count) and the
 * videos as the standard grid — every card gets the full action system.
 */
export function YtPlaylistClient({ playlistId }: { playlistId: string }) {
  const query = trpc.channel.ytPlaylist.useQuery(
    { playlistId },
    { staleTime: 10 * 60_000, retry: 1 },
  );

  if (query.isPending) {
    return (
      <p className="py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Loading playlist…
      </p>
    );
  }
  if (query.isError || !query.data) {
    return (
      <p className="rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Could not load this playlist. Try again later.
      </p>
    );
  }

  const playlist = query.data;
  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          YouTube playlist · {playlist.videos.length}
          {playlist.videos.length === 1 ? " video" : " videos"}
        </p>
        <h1 className="m-0 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
          {playlist.title}
        </h1>
        {playlist.channelName ? (
          <p className="m-0 text-sm text-[hsl(var(--muted-foreground))]">
            {playlist.channelId ? (
              <Link
                href={`/channel/${encodeURIComponent(playlist.channelId)}`}
                className="font-medium text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] hover:underline"
              >
                {playlist.channelName}
              </Link>
            ) : (
              playlist.channelName
            )}
          </p>
        ) : null}
      </header>

      {playlist.videos.length > 0 ? (
        <VideoGrid videos={playlist.videos} size="large" />
      ) : (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
          This playlist is empty (or its videos are unavailable).
        </p>
      )}
    </div>
  );
}
