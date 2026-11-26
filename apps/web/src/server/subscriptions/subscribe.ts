import { fetchChannelPage } from "@/server/catalog";
import { refreshChannelsLatestVideoAt } from "@/server/channel-meta/recency";
import {
  nowUnix,
  refreshChannelMetaIfStale,
} from "@/server/channel-meta/store";
import type { AppDb } from "@/server/db/client";
import { subscriptions } from "@/server/db/schema";
import { requestFeedPublish } from "@/server/remote/publish-loop";
import { refreshChannelRss, refreshLongFormWindow } from "@/server/rss/cache";

/**
 * Subscribe a user to a channel (idempotent) and warm what the merged feed
 * and sidebar need. `channelId` must already be canonical.
 */
export async function subscribeToChannel(
  db: AppDb,
  userId: number,
  channelId: string,
): Promise<void> {
  db.insert(subscriptions)
    .values({ userId, channelId, subscribedAt: nowUnix() })
    .onConflictDoNothing({
      target: [subscriptions.userId, subscriptions.channelId],
    })
    .run();
  // Populate name + avatar now so the sidebar shows them immediately instead
  // of the raw channel id (usually cached already from viewing the channel).
  await refreshChannelMetaIfStale(db, channelId).catch(() => {});
  // Warm the new channel's feed inputs immediately (fire-and-forget) so it
  // shows up in the merged feed and sorts correctly without waiting for
  // the next cache-warmer cycle. Once its uploads are cached, publish the
  // feeds right away so the channel's RSS URL can be copied immediately
  // (the publisher skips channels with no cached uploads).
  void Promise.allSettled([
    refreshChannelRss(db, channelId).finally(requestFeedPublish),
    refreshLongFormWindow(db, channelId),
    fetchChannelPage({ channelId }),
  ]).then(() => refreshChannelsLatestVideoAt(db, [channelId]).catch(() => {}));
}
