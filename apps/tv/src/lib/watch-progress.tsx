import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { trpc } from "@/lib/trpc-react";

/**
 * Watch positions for every video, shared by thumbnails and by "open video"
 * so a card can show progress and playback can resume where it left off.
 *
 * One react-query entry backs all of them: cards call the hook individually and
 * react-query dedupes to a single request, so this needs no provider or manual
 * fetch — and it inherits the caching, retry and persistence everything else
 * uses. The web reaches the same result through a page-level context.
 */

/** Below this the bar is noise; above it the video counts as finished. */
const MIN_FRACTION = 0.01;
const COMPLETE_FRACTION = 0.97;
/** Don't resume from the first few seconds — starting over is what's wanted. */
const MIN_RESUME_SECONDS = 5;

export type WatchProgress = { fraction: number; completed: boolean };

function useProgressRows() {
  const query = trpc.history.progressAll.useQuery(undefined, {
    // Progress is decoration; a failure shouldn't retry aggressively.
    retry: 1,
  });
  return query.data;
}

/** Progress for one video, or null when there is nothing worth drawing. */
export function useWatchProgress(videoId: string): WatchProgress | null {
  const rows = useProgressRows();
  const row = rows?.find((r) => r.videoId === videoId);
  if (!row) return null;
  if (row.completed) return { fraction: 1, completed: true };
  const duration = row.videoDurationSeconds;
  if (!duration || duration <= 0) return null;
  const fraction = row.positionSeconds / duration;
  if (fraction < MIN_FRACTION) return null;
  return { fraction: Math.min(fraction, 1), completed: false };
}

/**
 * Seconds to resume from, or undefined to start at the beginning — which is
 * what a finished (or barely started) video should do.
 */
export function useResumeLookup(): (videoId: string) => number | undefined {
  const rows = useProgressRows();
  return useCallback(
    (videoId: string) => {
      const row = rows?.find((r) => r.videoId === videoId);
      if (!row || row.completed) return undefined;
      const duration = row.videoDurationSeconds;
      if (duration && row.positionSeconds / duration > COMPLETE_FRACTION) {
        return undefined;
      }
      return row.positionSeconds > MIN_RESUME_SECONDS
        ? row.positionSeconds
        : undefined;
    },
    [rows],
  );
}

/** Leaving the player writes new progress; pull it so the bars update. */
export function useWatchProgressRefresh(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [["history", "progressAll"]],
    });
  }, [queryClient]);
}
