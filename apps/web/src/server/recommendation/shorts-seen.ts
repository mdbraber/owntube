import { and, eq, gt, lte } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { shortsSeen } from "@/server/db/schema";

/** Shorts scrolled past within this window are hard-excluded from the feed. */
export const SHORTS_SEEN_HARD_WINDOW_SEC = 45 * 24 * 3600;
/** Shorts seen between the hard and soft windows may resurface, down-ranked. */
export const SHORTS_SEEN_SOFT_WINDOW_SEC = 90 * 24 * 3600;

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Shorts the user scrolled past recently (hard window). Older rows age out so
 * the candidate pool does not shrink forever; re-seeing a short refreshes its
 * timestamp (`recordShortSeen`), so only genuinely unseen-for-weeks ids recycle.
 */
export function loadShortSeenVideoIds(db: AppDb, userId: number): Set<string> {
  const cutoff = nowUnix() - SHORTS_SEEN_HARD_WINDOW_SEC;
  const rows = db
    .select({ videoId: shortsSeen.videoId })
    .from(shortsSeen)
    .where(and(eq(shortsSeen.userId, userId), gt(shortsSeen.seenAt, cutoff)))
    .limit(20_000)
    .all();
  return new Set(rows.map((r) => r.videoId));
}

/** Shorts in the soft band (seen 45–90 days ago) — resurfaceable but down-ranked in the pool. */
export function loadSoftSeenShortVideoIds(
  db: AppDb,
  userId: number,
): Set<string> {
  const now = nowUnix();
  const rows = db
    .select({ videoId: shortsSeen.videoId })
    .from(shortsSeen)
    .where(
      and(
        eq(shortsSeen.userId, userId),
        gt(shortsSeen.seenAt, now - SHORTS_SEEN_SOFT_WINDOW_SEC),
        lte(shortsSeen.seenAt, now - SHORTS_SEEN_HARD_WINDOW_SEC),
      ),
    )
    .limit(20_000)
    .all();
  return new Set(rows.map((r) => r.videoId));
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
