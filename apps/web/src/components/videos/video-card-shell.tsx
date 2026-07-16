"use client";

import type { ReactNode } from "react";
import { useWatchProgress } from "@/components/videos/video-membership-context";

/**
 * Client wrapper for the (server-rendered) feed card's <article>. Reads the
 * shared watch-progress map and de-emphasizes a card once its video is
 * watched — completed, or ≥90% (YouTube-style "counts as watched") — the same
 * "already seen" recede a fresh page load shows for a finished video. Still
 * honors the explicit `dimmed` prop (ignored videos on a channel page). We
 * dim rather than remove: the card stays available, it just recedes.
 */
export function VideoCardShell({
  videoId,
  dimmed,
  children,
}: {
  videoId?: string;
  dimmed?: boolean;
  children: ReactNode;
}) {
  const progress = useWatchProgress(videoId);
  const watched = progress
    ? progress.completed || progress.fraction >= 0.9
    : false;
  const recede = dimmed || watched;
  return (
    <article
      data-watched={watched ? "" : undefined}
      className={`ot-video-card group flex flex-col gap-3 text-left text-[hsl(var(--foreground))]${
        recede ? " opacity-40 transition-opacity hover:opacity-75" : ""
      }`}
    >
      {children}
    </article>
  );
}
