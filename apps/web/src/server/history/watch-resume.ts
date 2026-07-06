import { and, desc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";

/** Ignore trivial progress — reopening after a few seconds should start over. */
const MIN_RESUME_SECONDS = 15;
/** Treat a video watched past this fraction as finished; don't resume near the end. */
const RESUME_MAX_RATIO = 0.95;

/**
 * Position (seconds) to resume a previously-watched, unfinished video, or null
 * when it should start from the beginning (never watched, completed, barely
 * started, or effectively finished). Uses recorded watch progress, so it is an
 * approximation of the exact playback position.
 */
export function getWatchResumeSeconds(
  db: AppDb,
  userId: number,
  videoId: string,
  fallbackDurationSeconds?: number,
): number | null {
  const row = db
    .select({
      durationWatched: watchHistory.durationWatched,
      videoDurationSeconds: watchHistory.videoDurationSeconds,
      completed: watchHistory.completed,
    })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, userId),
        eq(watchHistory.videoId, videoId),
        eq(watchHistory.isDeleted, 0),
      ),
    )
    .orderBy(desc(watchHistory.startedAt))
    .limit(1)
    .all()[0];

  if (!row || row.completed) return null;
  const watched = row.durationWatched;
  if (watched < MIN_RESUME_SECONDS) return null;

  const total =
    row.videoDurationSeconds > 0
      ? row.videoDurationSeconds
      : (fallbackDurationSeconds ?? 0);
  if (total > 0 && watched >= RESUME_MAX_RATIO * total) return null;

  return watched;
}
