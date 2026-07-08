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
  liveFraction,
  className,
}: {
  videoId?: string;
  /** Live playback position (hover preview) — overrides the stored value. */
  liveFraction?: number | null;
  className?: string;
}) {
  const stored = useWatchProgress(videoId);
  const live = liveFraction ?? null;
  if (live == null && !stored) return null;
  if (live == null && stored && !stored.completed && stored.fraction < 0.01) {
    return null;
  }

  const fraction = live ?? stored?.fraction ?? 0;
  const completed =
    (stored?.completed ?? false) || (live != null && live >= 0.985);
  const progress = { fraction, completed };

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
