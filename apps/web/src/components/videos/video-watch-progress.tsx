"use client";

import { useWatchProgress } from "@/components/videos/video-membership-context";
import { cn } from "@/lib/utils";

/**
 * Thumbnail watch-progress bar (bottom edge): brand fill for partial
 * progress, full-width emerald once completed — same treatment as the
 * history rows, fed by the shared page-level progress map so any card or
 * row can drop it in without its own query.
 */
export function VideoWatchProgress({
  videoId,
  className,
}: {
  videoId?: string;
  className?: string;
}) {
  const progress = useWatchProgress(videoId);
  if (!progress) return null;
  if (!progress.completed && progress.fraction < 0.01) return null;

  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1 bg-black/40",
        className,
      )}
      aria-hidden
    >
      <span
        className={cn(
          "block h-full",
          progress.completed ? "bg-emerald-500" : "bg-[hsl(var(--primary))]",
        )}
        style={{
          width: `${progress.completed ? 100 : Math.round(progress.fraction * 100)}%`,
        }}
      />
    </span>
  );
}
