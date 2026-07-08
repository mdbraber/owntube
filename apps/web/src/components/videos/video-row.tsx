"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CardSwipeLayer } from "@/components/videos/card-swipe-layer";
import { XIcon } from "@/components/videos/video-action-icons";
import type { VideoActionSurface } from "@/components/videos/video-action-registry";
import { VideoActionsMenu } from "@/components/videos/video-actions-menu";
import { VideoCardDurationBadge } from "@/components/videos/video-card-duration-badge";
import { VideoStatusPills } from "@/components/videos/video-status-pills";
import { VideoWatchProgress } from "@/components/videos/video-watch-progress";
import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";
import { cn } from "@/lib/utils";

type VideoRowProps = {
  videoId: string;
  title: string;
  channelId?: string | null;
  channelName?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number;
  /** Extra byline content after the channel (dot-separated). */
  meta?: ReactNode;
  /** Progress fraction 0–1; renders a watch-progress bar across the thumbnail bottom. */
  progress?: number;
  /** Completed videos show the bar in green instead of the brand color. */
  progressComplete?: boolean;
  /**
   * Leading slot content (position number, time of day). When `dragHandle` is
   * also given, the handle swaps in on hover, YouTube-playlist-style.
   */
  leading?: ReactNode;
  /** Drag-to-reorder handle (queue); revealed on hover in the leading slot. */
  dragHandle?: ReactNode;
  /** One-click removal — the hover ✕ (always visible on touch). */
  onRemove?: () => void;
  removeLabel?: string;
  removeDisabled?: boolean;
  /** Trims the kebab menu + suppresses the pill that restates this page. */
  surface: VideoActionSurface;
  /** Thumbnail size preset (home block sizing); md is the library default. */
  size?: "xs" | "sm" | "md" | "lg";
  /**
   * Touch swipe actions across the whole row (home blocks). Keep off on the
   * drag-reorderable pages — the gestures would fight.
   */
  enableSwipe?: boolean;
};

const ROW_THUMB_WIDTH: Record<"xs" | "sm" | "md" | "lg", string> = {
  xs: "w-28 sm:w-36",
  sm: "w-40 sm:w-48",
  md: "w-[12.75rem] sm:w-60",
  lg: "w-[16rem] sm:w-80",
};

/**
 * Shared row for the linear pages — Queue, History, Saved, playlist detail —
 * in the same visual language as the cards: borderless with a hover tint, the
 * shared duration badge / status pills / progress bar on the thumbnail, and
 * the same context-aware kebab. The leading slot carries the page's
 * linearity (position, time); removal is a quiet hover ✕ instead of a boxed
 * button.
 */
export function VideoRow({
  videoId,
  title,
  channelId,
  channelName,
  thumbnailUrl,
  durationSeconds,
  meta,
  progress,
  progressComplete = false,
  leading,
  dragHandle,
  onRemove,
  removeLabel = "Remove",
  removeDisabled,
  surface,
  size = "md",
  enableSwipe = false,
}: VideoRowProps) {
  const target = `/watch/${encodeURIComponent(videoId)}`;
  const pct =
    typeof progress === "number"
      ? Math.max(0, Math.min(100, Math.round(progress * 100)))
      : null;

  const row = (
    <div className="group flex items-center gap-3 rounded-[var(--radius-card)] p-2 transition hover:bg-[hsl(var(--muted)_/_0.45)]">
      {leading || dragHandle ? (
        <div className="flex min-w-6 shrink-0 items-center justify-center text-[hsl(var(--muted-foreground))]">
          {dragHandle ? (
            <>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  "group-hover:hidden group-focus-within:hidden",
                )}
              >
                {leading}
              </span>
              <span className="hidden group-hover:block group-focus-within:block">
                {dragHandle}
              </span>
            </>
          ) : (
            <span className="text-xs tabular-nums">{leading}</span>
          )}
        </div>
      ) : null}

      <div className="relative shrink-0">
        <Link href={target} className="block">
          <div
            className={cn(
              "relative aspect-video overflow-hidden rounded-xl bg-[hsl(var(--muted))]",
              ROW_THUMB_WIDTH[size],
            )}
          >
            {/* Derives the thumbnail from videoId when no explicit URL is given
                (denormalized history/library rows omit it). */}
            <VideoThumbnailImg
              url={thumbnailUrl ?? undefined}
              videoId={videoId}
              className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
              loading="lazy"
            />
            {pct !== null ? (
              <span className="absolute inset-x-0 bottom-0 z-10 h-1 bg-black/40">
                <span
                  className={cn(
                    "block h-full",
                    progressComplete
                      ? "bg-emerald-500"
                      : "bg-[hsl(var(--primary))]",
                  )}
                  style={{ width: `${progressComplete ? 100 : pct}%` }}
                />
              </span>
            ) : (
              // No explicit progress from the host — fall back to the shared
              // watch-progress map (queue/saved/playlist/home rows).
              <VideoWatchProgress videoId={videoId} />
            )}
          </div>
        </Link>
        {/* Outside the watch link: the status pills navigate on their own. */}
        <div className="pointer-events-none absolute inset-x-1 bottom-1 z-10 flex items-center justify-end gap-1">
          <VideoStatusPills videoId={videoId} size="sm" surface={surface} />
          <VideoCardDurationBadge
            durationSeconds={durationSeconds}
            positioned={false}
            className="px-1.5 py-px text-[10px]"
          />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <Link href={target} className="block min-w-0">
          <p className="m-0 line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]">
            {title}
          </p>
        </Link>
        <p className="mt-0.5 line-clamp-1 text-xs text-[hsl(var(--muted-foreground))]">
          {channelId ? (
            <Link
              href={`/channel/${encodeURIComponent(channelId)}`}
              className="hover:text-[hsl(var(--foreground))] hover:underline"
            >
              {channelName ?? channelId}
            </Link>
          ) : (
            channelName
          )}
          {meta ? (
            <>
              {channelId || channelName ? (
                <span className="mx-1.5 text-[hsl(var(--muted-foreground))]/60">
                  ·
                </span>
              ) : null}
              {meta}
            </>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {onRemove ? (
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] opacity-100 transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
            title={removeLabel}
            aria-label={removeLabel}
            disabled={removeDisabled}
            onClick={onRemove}
          >
            <XIcon className="h-4 w-4" />
          </button>
        ) : null}
        <VideoActionsMenu
          videoId={videoId}
          title={title}
          channelId={channelId ?? undefined}
          channelName={channelName ?? undefined}
          thumbnailUrl={thumbnailUrl ?? undefined}
          surface={surface}
          // The ✕ already covers removal here — keep it out of the menu.
          visibleActions={
            onRemove && surface === "queue"
              ? ["queue"]
              : onRemove && surface === "saved"
                ? ["save"]
                : undefined
          }
        />
      </div>
    </div>
  );

  if (!enableSwipe) return row;
  return (
    <CardSwipeLayer
      videoId={videoId}
      title={title}
      channelId={channelId ?? undefined}
      surface={surface}
    >
      {row}
    </CardSwipeLayer>
  );
}
