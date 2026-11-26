import { eq } from "drizzle-orm";
import { takeNewestVideos } from "@/lib/published-sort-key";
import {
  fetchChannelPage,
  fetchTrendingVideos,
  searchVideos,
} from "@/server/catalog";
import type { UnifiedVideo } from "@/server/catalog/types";
import type { AppDb } from "@/server/db/client";
import { subscriptions } from "@/server/db/schema";
import { useColdStartBlend } from "@/server/recommendation/coldstart";
import type { UserSignals } from "@/server/recommendation/signals";

const MIN_WATCH_ROWS_FOR_HISTORY_POOL = 3;
/**
 * Watched channels the user is *not* subscribed to. Channels are taken by
 * interest weight (recency-decayed, engagement-weighted), not by last-watched
 * order. Kept below the subscription slice: the home feed is centred on
 * subscriptions, and recent viewing is a secondary signal.
 */
const MAX_HISTORY_CHANNEL_FETCHES = 16;
/**
 * Subscribed channels paged per build (established users). A daily-rotating
 * window over *all* subscriptions, so every subscription shapes the feed within
 * a few days regardless of whether it was watched recently.
 */
export const SUBSCRIPTIONS_PER_BUILD = 48;
const VIDEOS_PER_SUBSCRIPTION = 8;
const VIDEOS_PER_HISTORY_CHANNEL = 12;
const MIN_UNIQUE_CANDIDATES_HISTORY_ONLY = 14;
const CHANNEL_FETCH_CONCURRENCY = 6;
/** When trending supplies a channel we did not page yet, fetch latest uploads so recs prefer newer unwatched videos. */
const MAX_TRENDING_ONLY_CHANNEL_HEAD_FETCHES = 12;
/**
 * Keyword searches per pool build. Every declared keyword used to fire on
 * every build (up to 96 × 8 results), which let "Refine recommendations" —
 * meant as a nudge — supply ~85% of the pool and turn the home feed into a
 * loop over the same few themes. Now a daily-rotating window of keywords
 * runs per build, so the keyword slice stays a minority next to history- and
 * related-driven candidates while every keyword still gets its turn within a
 * few days. Rotation is per day (and per user) so the pool cache, which
 * lives minutes, never sees the window move mid-day.
 */
export const KEYWORDS_PER_BUILD = 12;
const VIDEOS_PER_KEYWORD = 6;
const KEYWORD_SEARCH_CONCURRENCY = 3;
/**
 * Relevance-sorted search returns evergreen uploads (half the cached keyword
 * results were older than a year); restricting to the past year keeps the
 * keyword slice current while still deep enough to have real matches.
 */
const KEYWORD_SEARCH_DATE_WINDOW = "year" as const;

export type TaggedVideoCandidate = { video: UnifiedVideo; source: string };

/**
 * The keywords that run this build: a contiguous, wrapping window over the
 * user's (de-duplicated) keyword list that advances by `perBuild` each day, so
 * consecutive days cover disjoint slices until the list wraps. Lists that fit
 * in one window are returned whole.
 */
export function selectKeywordsForBuild(
  tasteKeywords: readonly string[],
  userId: number,
  nowSec: number,
  perBuild = KEYWORDS_PER_BUILD,
): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const kw of tasteKeywords) {
    const k = kw.trim();
    const low = k.toLowerCase();
    if (!k || seen.has(low)) continue;
    seen.add(low);
    cleaned.push(k);
  }
  if (cleaned.length <= perBuild) return cleaned;
  const day = Math.floor(nowSec / 86_400);
  const start =
    (((day * perBuild + userId) % cleaned.length) + cleaned.length) %
    cleaned.length;
  const out: string[] = [];
  for (let i = 0; i < perBuild; i += 1) {
    out.push(cleaned[(start + i) % cleaned.length] as string);
  }
  return out;
}

/**
 * The subscribed channels paged this build: a contiguous, wrapping window over
 * the subscriptions in a stable order (channel id), advancing by `perBuild`
 * each day. Lists that fit in one window are returned whole.
 */
export function selectSubscriptionsForBuild(
  subscribedChannelIds: readonly string[],
  userId: number,
  nowSec: number,
  perBuild = SUBSCRIPTIONS_PER_BUILD,
): string[] {
  const sorted = [...new Set(subscribedChannelIds)].filter(Boolean).sort();
  if (sorted.length <= perBuild) return sorted;
  const day = Math.floor(nowSec / 86_400);
  const start =
    (((day * perBuild + userId) % sorted.length) + sorted.length) %
    sorted.length;
  const out: string[] = [];
  for (let i = 0; i < perBuild; i += 1) {
    out.push(sorted[(start + i) % sorted.length] as string);
  }
  return out;
}

function withChannelAvatarFallback(
  video: UnifiedVideo,
  channelAvatarUrl: string | undefined,
): UnifiedVideo {
  if (video.channelAvatarUrl || !channelAvatarUrl) return video;
  return { ...video, channelAvatarUrl };
}

/**
 * Fetches recent uploads from subscriptions (a daily-rotating window over all
 * of them), watched-but-unsubscribed channels, and blends regional trending — same sources as the home recommendation pool.
 * After a trending blend, loads the channel “videos” tab for trending-only
 * channels so newer unwatched uploads can replace stale trending rows.
 * Channel pages use the SQLite cache (10 min TTL) to avoid bursting the
 * process upstream rate limiter on every home feed load.
 */
export async function collectTaggedVideoCandidates(
  db: AppDb,
  userId: number,
  args: {
    region: string;
    signals: UserSignals;
    /** "Refine recommendations" topics — each seeds an upstream search so the pool can include videos absent from the user's history. */
    tasteKeywords: string[];
  },
): Promise<{
  tagged: TaggedVideoCandidate[];
  recentCoverageByChannel: Map<string, number>;
  coldStart: boolean;
  needTrendingBlend: boolean;
  canBuildFromHistory: boolean;
  historyOnlyUnique: number;
  trendingWarning?: string;
}> {
  const { region, signals, tasteKeywords } = args;
  const nowSec = Math.floor(Date.now() / 1000);
  const coldStart = useColdStartBlend(signals.totalWatches);
  const taggedCandidates: TaggedVideoCandidate[] = [];
  const recentCoverageByChannel = new Map<string, number>();
  const channelsWithDedicatedPage = new Set<string>();

  const canBuildFromHistory =
    signals.totalWatches >= MIN_WATCH_ROWS_FOR_HISTORY_POOL &&
    signals.channelsOrderedByWeight.length > 0;

  /** Pages each channel's newest uploads into the pool under `sourcePrefix:<id>`. */
  const fetchChannelHeads = async (
    channelIds: readonly string[],
    perChannel: number,
    sourcePrefix: string,
    opts: { dedicated: boolean },
  ): Promise<void> => {
    for (let i = 0; i < channelIds.length; i += CHANNEL_FETCH_CONCURRENCY) {
      const batch = channelIds.slice(i, i + CHANNEL_FETCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (channelId) => {
          const ch = await fetchChannelPage({ channelId });
          return {
            channelId,
            channelAvatarUrl: ch.avatarUrl ?? undefined,
            page: takeNewestVideos(ch.videos, perChannel, nowSec),
          };
        }),
      );
      for (const item of settled) {
        if (item.status !== "fulfilled") continue;
        const { channelId, channelAvatarUrl, page } = item.value;
        if (opts.dedicated) channelsWithDedicatedPage.add(channelId);
        for (const v of page) {
          taggedCandidates.push({
            video: withChannelAvatarFallback(v, channelAvatarUrl),
            source: `${sourcePrefix}:${channelId}`,
          });
        }
        const pageIds = page
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
  };

  // Subscriptions come first and on every build (not only at cold start): they
  // are the user's declared, long-lived taste, so their uploads anchor the
  // taste centroid and seed related expansion even when the user has not
  // watched those channels lately.
  const subscribedChannelIds = db
    .select({ channelId: subscriptions.channelId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .all()
    .map((r) => r.channelId);
  const subscribedSet = new Set(subscribedChannelIds);
  await fetchChannelHeads(
    selectSubscriptionsForBuild(subscribedChannelIds, userId, nowSec),
    VIDEOS_PER_SUBSCRIPTION,
    "subscription",
    { dedicated: true },
  );

  // Watched-but-not-subscribed channels: a secondary slice so recent viewing
  // outside the subscriptions still counts, without steering the feed.
  if (canBuildFromHistory) {
    const historyChannels = signals.channelsOrderedByWeight
      .filter((id) => !subscribedSet.has(id))
      .slice(0, MAX_HISTORY_CHANNEL_FETCHES);
    await fetchChannelHeads(
      historyChannels,
      VIDEOS_PER_HISTORY_CHANNEL,
      "history_channel",
      { dedicated: true },
    );
  }

  const dedupePreview = new Map<string, UnifiedVideo>();
  for (const { video: v } of taggedCandidates) {
    if (!dedupePreview.has(v.videoId)) dedupePreview.set(v.videoId, v);
  }
  const historyOnlyUnique = dedupePreview.size;

  const needTrendingBlend =
    coldStart ||
    !canBuildFromHistory ||
    historyOnlyUnique < MIN_UNIQUE_CANDIDATES_HISTORY_ONLY;

  let trendingWarning: string | undefined;
  if (needTrendingBlend) {
    const trending = await fetchTrendingVideos({ region, limit: 45 });
    trendingWarning = trending.warning;
    for (const v of trending.videos) {
      taggedCandidates.push({ video: v, source: "trending" });
    }
    const trendingOnlyChannelIds = new Set<string>();
    for (const { video: v, source } of taggedCandidates) {
      if (source !== "trending") continue;
      const cid = v.channelId?.trim();
      if (!cid || channelsWithDedicatedPage.has(cid)) continue;
      trendingOnlyChannelIds.add(cid);
    }
    await fetchChannelHeads(
      [...trendingOnlyChannelIds]
        .sort()
        .slice(0, MAX_TRENDING_ONLY_CHANNEL_HEAD_FETCHES),
      VIDEOS_PER_HISTORY_CHANNEL,
      "trending_channel_head",
      { dedicated: false },
    );
  }

  // "Refine recommendations" keywords seed upstream searches so the pool can
  // surface topics the user is interested in but has not watched yet — the
  // taste model only re-ranks the candidate pool, it cannot conjure candidates.
  const keywords = selectKeywordsForBuild(tasteKeywords, userId, nowSec);
  for (let i = 0; i < keywords.length; i += KEYWORD_SEARCH_CONCURRENCY) {
    const batch = keywords.slice(i, i + KEYWORD_SEARCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (keyword) => {
        const result = await searchVideos({
          q: keyword,
          limit: VIDEOS_PER_KEYWORD,
          date: KEYWORD_SEARCH_DATE_WINDOW,
        });
        return { keyword, videos: result.videos };
      }),
    );
    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      const { keyword, videos } = item.value;
      for (const v of videos) {
        if (!v.videoId) continue;
        taggedCandidates.push({
          video: v,
          source: `keyword_search:${keyword}`,
        });
      }
    }
  }

  return {
    tagged: taggedCandidates,
    recentCoverageByChannel,
    coldStart,
    needTrendingBlend,
    canBuildFromHistory,
    historyOnlyUnique,
    trendingWarning,
  };
}
