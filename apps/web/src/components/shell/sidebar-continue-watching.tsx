"use client";

import Link from "next/link";
import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";
import { trpc } from "@/trpc/react";

type Props = {
  enabled: boolean;
};

/**
 * "Continue watching" sidebar shelf: partially-watched videos the user can
 * resume. Each item links to the watch page with a resume timestamp and shows a
 * progress bar. Hidden entirely when there is nothing to resume.
 */
export function SidebarContinueWatching({ enabled }: Props) {
  const { data } = trpc.history.continueWatching.useQuery(
    { limit: 6 },
    {
      enabled,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  );

  const rows = data ?? [];
  if (!enabled || rows.length === 0) return null;

  return (
    <>
      <div className="mx-2.5 my-3.5 h-px bg-[hsl(var(--border))]" />
      <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        Continue watching
      </div>
      <div className="max-h-[min(40vh,20rem)] overflow-y-auto overscroll-contain pr-0.5">
        {rows.map((r) => {
          const pct =
            r.videoDurationSeconds > 0
              ? Math.min(
                  100,
                  Math.round(
                    (r.durationWatched / r.videoDurationSeconds) * 100,
                  ),
                )
              : 0;
          return (
            <Link
              key={r.videoId}
              href={r.href}
              className="group flex w-full items-start gap-2.5 rounded-[var(--radius-shell)] px-2 py-2 text-left transition hover:bg-[hsl(var(--accent))]"
            >
              <div className="relative aspect-video w-[4.5rem] shrink-0 overflow-hidden rounded-md bg-[hsl(var(--muted))]">
                <VideoThumbnailImg
                  videoId={r.videoId}
                  url={r.thumbnailUrl}
                  className="h-full w-full object-cover"
                />
                <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                  <span
                    className="block h-full bg-[hsl(var(--primary))]"
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="line-clamp-2 text-[13px] font-medium leading-snug text-[hsl(var(--foreground))]">
                  {r.videoTitle}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                  {r.channelName}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
