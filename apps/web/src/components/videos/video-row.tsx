"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CardSwipeLayer } from "@/components/videos/card-swipe-layer";
import { XIcon } from "@/components/videos/video-action-icons";
import type { VideoActionSurface } from "@/components/videos/video-action-registry";
import { VideoActionsMenu } from "@/components/videos/video-actions-menu";
import { VideoRowQuickActions } from "@/components/videos/video-row-quick-actions";
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
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /**
   * Touch swipe actions across the whole row (home blocks). Keep off on the
   * drag-reorderable pages — the gestures would fight.
   */
  enableSwipe?: boolean;
};

/** Thumb width at ≥sm (below sm the row stacks and the thumb is full width). */
const ROW_THUMB_WIDTH_SM: Record<"xs" | "sm" | "md" | "lg" | "xl", string> = {
  xs: "sm:w-36",
  sm: "sm:w-48",
  md: "sm:w-60",
  lg: "sm:w-80",
  xl: "sm:w-[26rem]",
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

  const row = (
    <div className="group flex flex-col gap-2 rounded-[var(--radius-card)] p-2 transition hover:bg-[hsl(var(--muted)_/_0.45)] sm:flex-row sm:items-center sm:gap-3">
      {/* Desktop leading slot (position ⇄ drag handle); on phones it joins
          the title line below, so nothing sits beside the stacked thumb. */}
      {leading || dragHandle ? (
        <div className="hidden min-w-6 shrink-0 items-center justify-center text-[hsl(var(--muted-foreground))] sm:flex">
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

      <div className="relative w-full shrink-0 sm:w-auto">
        <Link href={target} className="block">
          <div
            className={cn(
              "relative aspect-video w-full overflow-hidden rounded-xl bg-[hsl(var(--muted))]",
              ROW_THUMB_WIDTH_SM[size],
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
            {/* One standard: the shared watch-progress component (live map,
                optimistic on mark-watched — full green when completed). */}
            <VideoWatchProgress videoId={videoId} />
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
        {/* Quick actions sit right above the title (desktop hover reveal). */}
        <VideoRowQuickActions
          videoId={videoId}
          title={title}
          channelId={channelId ?? undefined}
          surface={surface}
          className="mb-0.5 -ml-2"
        />
        <div className="flex items-start gap-1">
          {/* Phone: the position/drag handle rides the title line. */}
          {leading || dragHandle ? (
            <span className="flex h-8 shrink-0 items-center pr-1 text-xs tabular-nums text-[hsl(var(--muted-foreground))] sm:hidden">
              {dragHandle ?? leading}
            </span>
          ) : null}
          <Link href={target} className="mt-1 block min-w-0 flex-1">
            <p className="m-0 line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]">
              {title}
            </p>
          </Link>
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
