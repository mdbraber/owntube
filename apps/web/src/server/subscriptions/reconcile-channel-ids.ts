import { and, eq } from "drizzle-orm";
import {
  looksLikeYoutubeChannelId,
  normalizeYoutubeChannelId,
} from "@/lib/youtube-channel-id";
import type { AppDb } from "@/server/db/client";
import { subscriptions } from "@/server/db/schema";

/**
 * Fixes `channel_id` rows mangled by CSV import (name+UC…) or duplicated UC.
 * Safe to call on each list: after the first run, `canon === stored` for all.
 */
export function reconcileSubscriptionChannelIdsForUser(
  db: AppDb,
  userId: number,
): void {
  const rows = db
    .select({ channelId: subscriptions.channelId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .all();

  for (const { channelId: stored } of rows) {
    const canon = normalizeYoutubeChannelId(stored);
    if (canon === stored) continue;
    if (!looksLikeYoutubeChannelId(canon)) continue;

    const oldKey = and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.channelId, stored),
    );

    const hasCanon = db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.channelId, canon),
        ),
      )
      .limit(1)
      .all()[0];

    if (hasCanon) {
      db.delete(subscriptions).where(oldKey).run();
      continue;
    }

    db.update(subscriptions).set({ channelId: canon }).where(oldKey).run();
  }
}
