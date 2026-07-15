import { eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { subscriptions } from "@/server/db/schema";

/**
 * Channel IDs the user is subscribed to. Used to keep already-followed
 * channels out of recommendations when the user opts into
 * `excludeSubscribedFromRecommendations`.
 */
export function getSubscribedChannelIds(
  db: AppDb,
  userId: number,
): Set<string> {
  return new Set(
    db
      .select({ channelId: subscriptions.channelId })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .all()
      .map((r) => r.channelId),
  );
}
