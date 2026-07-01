import { and, desc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";
import { collectUserSignals } from "@/server/recommendation/signals";

/**
 * Row cap for the exclusion query. Most recent first: with a large imported
 * history (YouTube takeout can exceed 30k rows), an unordered cap would keep
 * an arbitrary old slice and let recently watched videos back into the feeds.
 */
const MAX_WATCHED_ROWS = 50_000;

/** Video ids to exclude from personalized Shorts / home feeds (all-time history + dislikes). */
export function loadWatchedVideoIdsForRecommendations(
  db: AppDb,
  userId: number,
): Set<string> {
  const watchedRows = db
    .select({ videoId: watchHistory.videoId })
    .from(watchHistory)
    .where(and(eq(watchHistory.userId, userId), eq(watchHistory.isDeleted, 0)))
    .orderBy(desc(watchHistory.startedAt))
    .limit(MAX_WATCHED_ROWS)
    .all();
  const watchedEver = new Set(watchedRows.map((r) => r.videoId));
  const signals = collectUserSignals(db, userId);
  for (const id of signals.dislikedVideoIds) {
    watchedEver.add(id);
  }
  return watchedEver;
}
