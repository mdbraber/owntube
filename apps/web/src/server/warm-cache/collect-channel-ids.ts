import { desc, eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { subscriptions, watchHistory } from "@/server/db/schema";

export const DEFAULT_WARM_HISTORY_CHANNELS = 32;
/** Cap subscription warms — large libraries would otherwise hammer upstream for hours. */
export const DEFAULT_WARM_SUBSCRIPTION_CHANNELS = 64;

export type CollectWarmChannelIdsOptions = {
  subscriptionLimit?: number;
  historyLimit?: number;
};

/** Distinct subscription channel ids (all users), most recently subscribed first. */
export function collectSubscriptionChannelIds(
  db: AppDb,
  maxChannels = DEFAULT_WARM_SUBSCRIPTION_CHANNELS,
): string[] {
  if (maxChannels <= 0) return [];

  const rows = db
    .select({
      channelId: subscriptions.channelId,
      subscribedAt: subscriptions.subscribedAt,
    })
    .from(subscriptions)
    .orderBy(desc(subscriptions.subscribedAt))
    .all();

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (seen.has(row.channelId)) continue;
    seen.add(row.channelId);
    out.push(row.channelId);
    if (out.length >= maxChannels) break;
  }
  return out;
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

/** Subscriptions first (recent), then recent history channels not already included. */
export function collectWarmChannelIds(
  db: AppDb,
  options: CollectWarmChannelIdsOptions = {},
): string[] {
  const subscriptionLimit =
    options.subscriptionLimit ?? DEFAULT_WARM_SUBSCRIPTION_CHANNELS;
  const historyLimit = options.historyLimit ?? DEFAULT_WARM_HISTORY_CHANNELS;

  const seen = new Set<string>();
  const out: string[] = [];

  for (const channelId of collectSubscriptionChannelIds(
    db,
    subscriptionLimit,
  )) {
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
