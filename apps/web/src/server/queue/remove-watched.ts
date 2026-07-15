import { and, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { watchQueue } from "@/server/db/schema";

/**
 * The queue is an up-next list, so finishing a video consumes its entry: this
 * runs on the completion signal itself, whether that came from the player
 * (played to the end / dwelled past the threshold) or from "mark as watched".
 *
 * Only *new* completions call this, never a re-watch of an already-watched
 * video, so an entry queued deliberately for a second viewing survives until
 * that viewing finishes.
 *
 * Returns the ids actually dequeued (empty for videos that were never queued).
 */
export function removeWatchedFromQueue(
  db: AppDb,
  userId: number,
  videoIds: string[],
): string[] {
  if (videoIds.length === 0) return [];
  const removed = db
    .delete(watchQueue)
    .where(
      and(eq(watchQueue.userId, userId), inArray(watchQueue.videoId, videoIds)),
    )
    .returning({ videoId: watchQueue.videoId })
    .all();
  return removed.map((r) => r.videoId);
}
