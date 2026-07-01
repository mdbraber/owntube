import { desc, eq } from "drizzle-orm";
import { takeNewestVideos } from "@/lib/published-sort-key";
import { filterShortsFeedVideos } from "@/lib/short-video";
import type { AppDb } from "@/server/db/client";
import { subscriptions } from "@/server/db/schema";
import { useColdStartBlend } from "@/server/recommendation/coldstart";
import type { UserSignals } from "@/server/recommendation/signals";
import {
  fetchChannelPage,
  fetchShortsFeed,
  type ProxySourceOverrides,
} from "@/server/services/proxy";
import type { UnifiedVideo } from "@/server/services/proxy.types";

const MIN_UNIQUE_SHORTS_FOR_HISTORY_POOL = 8;
const MAX_CHANNEL_SHORTS_FETCHES = 28;
const SHORTS_PER_CHANNEL = 14;
const CHANNEL_FETCH_CONCURRENCY = 4;

export type ShortsVideoCandidate = { video: UnifiedVideo; source: string };

function withChannelAvatarFallback(
  video: UnifiedVideo,
  channelAvatarUrl: string | undefined,
): UnifiedVideo {
  if (video.channelAvatarUrl || !channelAvatarUrl) return video;
  return { ...video, channelAvatarUrl };
}

function orderedChannelsForShorts(
  db: AppDb,
  userId: number,
  signals: UserSignals,
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (channelId: string | undefined) => {
    const id = channelId?.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };

  const byWeight = [...signals.channelWeights.entries()].sort(
    (a, b) => b[1] - a[1],
  );
  for (const [channelId] of byWeight) add(channelId);
  for (const channelId of signals.channelsOrderedByRecentWatch) {
    add(channelId);
  }
  for (const channelId of signals.interactionInterestChannelIds) {
    add(channelId);
  }

  const subs = db
    .select({
      channelId: subscriptions.channelId,
      subscribedAt: subscriptions.subscribedAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.subscribedAt))
    .limit(64)
    .all();
  const sortedSubs = [...subs].sort((a, b) => {
    const wa = signals.channelWeights.get(a.channelId) ?? 0;
    const wb = signals.channelWeights.get(b.channelId) ?? 0;
    if (wb !== wa) return wb - wa;
    return b.subscribedAt - a.subscribedAt;
  });
  for (const row of sortedSubs) add(row.channelId);

  return order.slice(0, MAX_CHANNEL_SHORTS_FETCHES);
}

/**
 * Shorts from the same channels as home recommendations (history, subs, taste),
 * using each channel's Shorts tab instead of filtering long-form home candidates.
 */
export async function collectShortsCandidates(
  db: AppDb,
  userId: number,
  args: {
    region: string;
    overrides?: ProxySourceOverrides;
    signals: UserSignals;
    tasteDiscoveryQueries?: string[];
    blockedChannelIds?: ReadonlySet<string>;
    /** Caps channel Shorts tab fetches (home shelf uses a small budget). */
    maxChannels?: number;
  },
): Promise<{
  tagged: ShortsVideoCandidate[];
  recentCoverageByChannel: Map<string, number>;
  coldStart: boolean;
  needDiscoveryBlend: boolean;
}> {
  const {
    region,
    overrides,
    signals,
    tasteDiscoveryQueries,
    blockedChannelIds,
    maxChannels,
  } = args;
  const nowSec = Math.floor(Date.now() / 1000);
  const coldStart = useColdStartBlend(signals.totalWatches);
  const tagged: ShortsVideoCandidate[] = [];
  const recentCoverageByChannel = new Map<string, number>();

  const channelCap = Math.min(
    MAX_CHANNEL_SHORTS_FETCHES,
    Math.max(1, maxChannels ?? MAX_CHANNEL_SHORTS_FETCHES),
  );
  const channels = orderedChannelsForShorts(db, userId, signals).slice(
    0,
    channelCap,
  );
  for (let i = 0; i < channels.length; i += CHANNEL_FETCH_CONCURRENCY) {
    const batch = channels.slice(i, i + CHANNEL_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (channelId) => {
        if (blockedChannelIds?.has(channelId)) {
          return {
            channelId,
            channelAvatarUrl: undefined,
            shorts: [] as UnifiedVideo[],
          };
        }
        const ch = await fetchChannelPage(
          db,
          { channelId, tab: "shorts" },
          overrides,
        );
        const shorts = filterShortsFeedVideos(
          takeNewestVideos(ch.videos, SHORTS_PER_CHANNEL, nowSec),
        );
        return {
          channelId,
          channelAvatarUrl: ch.avatarUrl ?? undefined,
          shorts,
        };
      }),
    );
    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      const { channelId, channelAvatarUrl, shorts } = item.value;
      for (const v of shorts) {
        tagged.push({
          video: withChannelAvatarFallback(v, channelAvatarUrl),
          source: `channel_shorts:${channelId}`,
        });
      }
      const pageIds = shorts
        .map((v) => v.videoId)
        .filter((id) => id.length > 0);
      if (pageIds.length > 0) {
        let hit = 0;
        for (const id of pageIds) {
          if (signals.watchedVideoIds.has(id)) hit += 1;
        }
        recentCoverageByChannel.set(channelId, hit / pageIds.length);
      }
    }
  }

  const unique = new Set(tagged.map((t) => t.video.videoId));
  const needDiscoveryBlend = unique.size < MIN_UNIQUE_SHORTS_FOR_HISTORY_POOL;

  if (needDiscoveryBlend) {
    try {
      const discovery = await fetchShortsFeed(
        db,
        {
          region,
          limit: 40,
          discoveryQueries: tasteDiscoveryQueries,
        },
        overrides,
      );
      for (const v of filterShortsFeedVideos(discovery.videos)) {
        if (unique.has(v.videoId)) continue;
        if (v.channelId && blockedChannelIds?.has(v.channelId)) continue;
        unique.add(v.videoId);
        tagged.push({ video: v, source: "shorts_discovery" });
      }
    } catch {
      // optional blend
    }
  }

  return {
    tagged,
    recentCoverageByChannel,
    coldStart,
    needDiscoveryBlend,
  };
}
