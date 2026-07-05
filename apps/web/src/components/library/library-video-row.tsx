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
  leading,
  trailing,
}: LibraryVideoRowProps) {
  const href = `/watch/${encodeURIComponent(videoId)}`;
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      {leading ? <div className="shrink-0 self-center">{leading}</div> : null}
      <Link href={href} className="block shrink-0">
        <div className="relative aspect-video w-44 overflow-hidden rounded-lg bg-[hsl(var(--muted))]">
          {thumbnailUrl ? (
            <VideoThumbnailImg
              url={thumbnailUrl}
              videoId={videoId}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
        </div>
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <Link href={href} className="line-clamp-2 font-medium hover:underline">
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
