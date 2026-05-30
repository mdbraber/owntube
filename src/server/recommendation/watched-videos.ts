import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";
import { collectUserSignals } from "@/server/recommendation/signals";

/** Video ids to exclude from personalized Shorts / home feeds (all-time history + dislikes). */
export function loadWatchedVideoIdsForRecommendations(
  db: AppDb,
  userId: number,
): Set<string> {
  const watchedRows = db
    .select({ videoId: watchHistory.videoId })
    .from(watchHistory)
    .where(and(eq(watchHistory.userId, userId), eq(watchHistory.isDeleted, 0)))
    .limit(10_000)
    .all();
  const watchedEver = new Set(watchedRows.map((r) => r.videoId));
  const signals = collectUserSignals(db, userId);
  for (const id of signals.dislikedVideoIds) {
    watchedEver.add(id);
  }
  return watchedEver;
}
