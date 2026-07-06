"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";

type LibraryVideoRowProps = {
  videoId: string;
  title: string;
  channelId?: string | null;
  channelName?: string | null;
  thumbnailUrl?: string | null;
  /** Extra metadata line under the channel (e.g. position, saved date). */
  meta?: ReactNode;
  /** Progress fraction 0–1; renders a watch-progress bar across the thumbnail bottom. */
  progress?: number;
  /** Leading control, e.g. a drag handle. */
  leading?: ReactNode;
  /** Trailing action(s), e.g. Remove / Unqueue. */
  trailing?: ReactNode;
};

/**
 * Shared row layout for the library pages (History / Queue / Saved): a
 * thumbnail + title + channel, with optional leading and trailing slots so each
 * page supplies its own actions while keeping one consistent look.
 */
export function LibraryVideoRow({
  videoId,
  title,
  channelId,
  channelName,
  thumbnailUrl,
  meta,
  progress,
  leading,
  trailing,
}: LibraryVideoRowProps) {
  const target = `/watch/${encodeURIComponent(videoId)}`;
  const pct =
    typeof progress === "number"
      ? Math.max(0, Math.min(100, Math.round(progress * 100)))
      : null;
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      {leading ? <div className="shrink-0 self-center">{leading}</div> : null}
      <Link href={target} className="block shrink-0">
        <div className="relative aspect-video w-44 overflow-hidden rounded-lg bg-[hsl(var(--muted))]">
          {/* Derives the thumbnail from videoId when no explicit URL is given
              (denormalized history/library rows omit it); renders nothing only
              when no source can be built at all. */}
          <VideoThumbnailImg
            url={thumbnailUrl ?? undefined}
            videoId={videoId}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {pct !== null ? (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
              <span
                className="block h-full bg-[hsl(var(--primary))]"
                style={{ width: `${pct}%` }}
              />
            </span>
          ) : null}
        </div>
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <Link
          href={target}
          className="line-clamp-2 font-medium hover:underline"
        >
          {title}
        </Link>
        {channelId ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            <Link
              href={`/channel/${encodeURIComponent(channelId)}`}
              className="hover:underline"
            >
              {channelName ?? channelId}
            </Link>
          </p>
        ) : null}
        {meta ? (
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            {meta}
          </div>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0 self-center">{trailing}</div> : null}
    </div>
  );
}
