import { desc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { subscriptions, watchHistory } from "@/server/db/schema";

export const DEFAULT_WARM_HISTORY_CHANNELS = 32;

/** Distinct subscription channel ids (all users). */
export function collectSubscriptionChannelIds(db: AppDb): string[] {
  const rows = db
    .selectDistinct({ channelId: subscriptions.channelId })
    .from(subscriptions)
    .all();
  return rows.map((row) => row.channelId);
}

/**
 * Most recently watched channels across all users, deduplicated by recency.
 * Aligns with recommendation history pool size (`MAX_HISTORY_CHANNEL_FETCHES`).
 */
export function collectRecentHistoryChannelIds(
  db: AppDb,
  limit: number,
): string[] {
  if (limit <= 0) return [];

  const rows = db
    .select({
      channelId: watchHistory.channelId,
      startedAt: watchHistory.startedAt,
    })
    .from(watchHistory)
    .where(eq(watchHistory.isDeleted, 0))
    .orderBy(desc(watchHistory.startedAt))
    .limit(Math.max(limit * 10, limit))
    .all();

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (seen.has(row.channelId)) continue;
    seen.add(row.channelId);
    out.push(row.channelId);
    if (out.length >= limit) break;
  }
  return out;
}

/** Subscriptions first, then recent history channels not already included. */
export function collectWarmChannelIds(
  db: AppDb,
  historyLimit = DEFAULT_WARM_HISTORY_CHANNELS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const channelId of collectSubscriptionChannelIds(db)) {
    if (seen.has(channelId)) continue;
    seen.add(channelId);
    out.push(channelId);
  }

  for (const channelId of collectRecentHistoryChannelIds(db, historyLimit)) {
    if (seen.has(channelId)) continue;
    seen.add(channelId);
    out.push(channelId);
  }

  return out;
}
