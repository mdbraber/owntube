import { and, desc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { shortsSeen } from "@/server/db/schema";

/**
 * Safety cap on how many seen ids we hard-exclude — effectively unbounded for
 * any realistic history, but keeps the exclusion set (and its IN clause) sane.
 * The newest ids are kept, so if a user ever exceeds this the feed still favors
 * excluding what they saw most recently.
 */
const SHORTS_SEEN_MAX = 50_000;

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Every short the user has seen or been offered — hard-excluded from the feed
 * for good. No recycle window: once shown, a short is never proposed again
 * (the user's explicit preference). Newest-first, capped by SHORTS_SEEN_MAX.
 */
export function loadShortSeenVideoIds(db: AppDb, userId: number): Set<string> {
  const rows = db
    .select({ videoId: shortsSeen.videoId })
    .from(shortsSeen)
    .where(eq(shortsSeen.userId, userId))
    .orderBy(desc(shortsSeen.seenAt))
    .limit(SHORTS_SEEN_MAX)
    .all();
  return new Set(rows.map((r) => r.videoId));
}

/**
 * Previously the 45–90-day "soft band" that could resurface down-ranked. Seen
 * shorts no longer recycle, so nothing resurfaces — kept as an empty set so
 * callers (the recommendation pool) need no change.
 */
export function loadSoftSeenShortVideoIds(
  _db: AppDb,
  _userId: number,
): Set<string> {
  return new Set();
}

export function recordShortSeen(
  db: AppDb,
  userId: number,
  videoId: string,
  channelId: string,
): void {
  const trimmedId = videoId.trim();
  if (trimmedId.length < 5) return;
  const ts = nowUnix();
  const existing = db
    .select({ id: shortsSeen.id })
    .from(shortsSeen)
    .where(
      and(eq(shortsSeen.userId, userId), eq(shortsSeen.videoId, trimmedId)),
    )
    .limit(1)
    .all()[0];

  if (existing) {
    db.update(shortsSeen)
      .set({
        channelId: channelId.trim() || "unknown",
        seenAt: ts,
      })
      .where(eq(shortsSeen.id, existing.id))
      .run();
    return;
  }

  db.insert(shortsSeen)
    .values({
      userId,
      videoId: trimmedId,
      channelId: channelId.trim() || "unknown",
      seenAt: ts,
    })
    .run();
}
