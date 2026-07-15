import { and, desc, eq, gt } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { interactions, watchHistory } from "@/server/db/schema";
import { getQueuedAndPlaylistVideoRefs } from "@/server/recommendation/collected-videos";

export type UserSignals = {
  channelWeights: Map<string, number>;
  totalWatches: number;
  watchedVideoIds: Set<string>;
  /** Latest `started_at` per video (unix seconds), for decaying repeat penalties. */
  watchedVideoLastSeen: Map<string, number>;
  /** Distinct videos watched per channel (same 90d window as `channelWeights`). */
  distinctWatchesByChannel: Map<string, number>;
  /** Distinct `video_id` count in that window (one video belongs to one channel). */
  totalDistinctVideosWatched: number;
  /** Max `started_at` (unix s) per channel in the window — for recency-biased scoring. */
  channelLastWatchedAt: Map<string, number>;
  /** Channel ids from history, ordered by most recent watch on that channel (desc). */
  channelsOrderedByRecentWatch: string[];
  /** All channel ids that appear in the watch window (for filters / bypass). */
  historyChannelIds: Set<string>;
  /** Videos the user liked (excluding those also disliked). */
  likedVideoIds: Set<string>;
  /** Videos the user disliked — excluded from recommendations. */
  dislikedVideoIds: Set<string>;
  /**
   * Positively-collected videos (excluding disliked), for taste corpus /
   * affinity: explicit saves plus queued and playlisted videos, which are
   * treated as the same kind of endorsement.
   */
  savedVideoIds: Set<string>;
  /**
   * Channels from like/save interactions (with `channel_id` set), for topic gate
   * and channel affinity (also folded into `channelWeights`).
   */
  interactionInterestChannelIds: Set<string>;
  /**
   * Long-form videos the user bounced off quickly (and never finished, liked or
   * saved). Feeds the dislike corpus as a soft negative topic signal.
   */
  quickSkipVideoIds: Set<string>;
};

const WINDOW_SEC = 90 * 24 * 3600;
/** Recent plays weigh more: `exp(-age / tau)` is near 1 right after a watch, then decays. */
const CHANNEL_RECENCY_TAU_SEC = 6 * 24 * 3600;

/** Likes/saves boost channel affinity with a slower decay than single watches. */
const INTERACTION_CHANNEL_TAU_SEC = 45 * 24 * 3600;
const LIKE_CHANNEL_WEIGHT = 0.52;
const SAVE_CHANNEL_WEIGHT = 0.34;

export type WatchEngagement =
  | "completed"
  | "engaged"
  | "neutral"
  | "skip"
  | "unknown";

/** Dwell ≥ this share of the video length counts as an engaged watch. */
const ENGAGED_RATIO = 0.7;
/** A long-form bounce: little absolute dwell AND a small share of the video. */
const SKIP_MAX_SEC = 45;
const SKIP_MAX_RATIO = 0.25;
/** A short glanced for under this many seconds was scrolled past, not watched. */
const SHORTS_SKIP_MAX_SEC = 4;

/**
 * Classifies one watch row by how much of the video was actually consumed.
 * Rows with `videoDurationSeconds = 0` predate honest dwell tracking (or the
 * length was unavailable) — they are always "unknown" so legacy data, which
 * uniformly claimed full completion, can neither boost nor punish.
 */
export function classifyWatchEngagement(row: {
  durationWatched: number;
  completed: number;
  videoDurationSeconds: number;
  isShort: number;
}): WatchEngagement {
  if (row.videoDurationSeconds <= 0) return "unknown";
  if (row.durationWatched <= 0) return "unknown";
  if (row.isShort === 1) {
    if (row.completed === 1) return "completed";
    if (row.durationWatched < SHORTS_SKIP_MAX_SEC) return "skip";
    return "neutral";
  }
  if (row.completed === 1) return "completed";
  const ratio = row.durationWatched / row.videoDurationSeconds;
  if (ratio >= ENGAGED_RATIO) return "engaged";
  // The neutral band protects long videos legitimately left mid-way: 20 minutes
  // into an hour-long video is interest, not a bounce.
  if (row.durationWatched < SKIP_MAX_SEC && ratio < SKIP_MAX_RATIO) {
    return "skip";
  }
  return "neutral";
}

/** Higher rank wins when several rows exist for the same video (e.g. re-opened later). */
const ENGAGEMENT_RANK: Record<WatchEngagement, number> = {
  completed: 4,
  engaged: 3,
  neutral: 2,
  skip: 1,
  unknown: 0,
};

/**
 * Channel-weight multiplier per engagement class. Always positive so channel
 * weights keep their semantics everywhere (`channelWeights.has`, max
 * normalization, gates); skips count as near-zero interest, not anti-interest.
 */
const ENGAGEMENT_CHANNEL_MULTIPLIER: Record<WatchEngagement, number> = {
  completed: 1.3,
  engaged: 1.15,
  neutral: 1.0,
  skip: 0.15,
  unknown: 1.0,
};

/** Cap on skip titles appended to the dislike corpus — explicit dislikes stay dominant. */
const MAX_SKIP_TITLES_IN_DISLIKE_CORPUS = 16;

/**
 * Video ids for the dislike TF-IDF corpus: explicit dislikes first (dominant),
 * then a small tail of quick-skipped videos as a soft topic signal.
 */
export function dislikeCorpusVideoIds(
  signals: Pick<UserSignals, "dislikedVideoIds" | "quickSkipVideoIds">,
): string[] {
  const skipTail = [...signals.quickSkipVideoIds]
    .filter((id) => !signals.dislikedVideoIds.has(id))
    .slice(0, MAX_SKIP_TITLES_IN_DISLIKE_CORPUS);
  return [...signals.dislikedVideoIds, ...skipTail];
}

export function collectUserSignals(
  db: AppDb,
  userId: number,
  opts: { excludeShorts?: boolean } = {},
): UserSignals {
  const nowSec = Math.floor(Date.now() / 1000);
  const since = nowSec - WINDOW_SEC;
  const watchConditions = [
    eq(watchHistory.userId, userId),
    eq(watchHistory.isDeleted, 0),
    gt(watchHistory.startedAt, since),
  ];
  // Long-form recommendations must ignore Shorts-feed watches: scrolling Shorts
  // records a row per glanced short, which would otherwise promote viral junk
  // channels into the home feed as "channels you watch".
  if (opts.excludeShorts) {
    watchConditions.push(eq(watchHistory.isShort, 0));
  }
  const rows = db
    .select({
      videoId: watchHistory.videoId,
      channelId: watchHistory.channelId,
      startedAt: watchHistory.startedAt,
      durationWatched: watchHistory.durationWatched,
      completed: watchHistory.completed,
      videoDurationSeconds: watchHistory.videoDurationSeconds,
      isShort: watchHistory.isShort,
    })
    .from(watchHistory)
    .where(and(...watchConditions))
    .orderBy(desc(watchHistory.startedAt))
    .limit(300)
    .all();

  // Per-video engagement: the best row wins, so a session's bare mount event
  // (durationWatched=0) cannot contradict the completed row that followed it.
  const engagementByVideo = new Map<string, WatchEngagement>();
  const hasLongFormRow = new Set<string>();
  for (const r of rows) {
    const cls = classifyWatchEngagement(r);
    const prev = engagementByVideo.get(r.videoId);
    if (!prev || ENGAGEMENT_RANK[cls] > ENGAGEMENT_RANK[prev]) {
      engagementByVideo.set(r.videoId, cls);
    }
    if (r.isShort === 0) hasLongFormRow.add(r.videoId);
  }

  const channelWeights = new Map<string, number>();
  const channelLastWatchedAt = new Map<string, number>();
  const watchedVideoIds = new Set<string>();
  const watchedVideoLastSeen = new Map<string, number>();
  const distinctSetsByChannel = new Map<string, Set<string>>();
  for (const r of rows) {
    watchedVideoIds.add(r.videoId);
    const ageSec = Math.max(0, nowSec - r.startedAt);
    const engagement = engagementByVideo.get(r.videoId) ?? "unknown";
    const channelContrib =
      Math.exp(-ageSec / CHANNEL_RECENCY_TAU_SEC) *
      ENGAGEMENT_CHANNEL_MULTIPLIER[engagement];
    channelWeights.set(
      r.channelId,
      (channelWeights.get(r.channelId) ?? 0) + channelContrib,
    );
    const prevLw = channelLastWatchedAt.get(r.channelId) ?? 0;
    channelLastWatchedAt.set(r.channelId, Math.max(prevLw, r.startedAt));
    const prev = watchedVideoLastSeen.get(r.videoId) ?? 0;
    watchedVideoLastSeen.set(r.videoId, Math.max(prev, r.startedAt));
    let set = distinctSetsByChannel.get(r.channelId);
    if (!set) {
      set = new Set();
      distinctSetsByChannel.set(r.channelId, set);
    }
    set.add(r.videoId);
  }

  const distinctWatchesByChannel = new Map<string, number>();
  for (const [ch, ids] of distinctSetsByChannel) {
    distinctWatchesByChannel.set(ch, ids.size);
  }

  const historyChannelIds = new Set(channelLastWatchedAt.keys());

  const likedVideoIds = new Set<string>();
  const dislikedVideoIds = new Set<string>();
  const savedVideoIds = new Set<string>();
  const interactionInterestChannelIds = new Set<string>();

  const interactionRows = db
    .select({
      videoId: interactions.videoId,
      channelId: interactions.channelId,
      type: interactions.type,
      createdAt: interactions.createdAt,
    })
    .from(interactions)
    .where(eq(interactions.userId, userId))
    .orderBy(desc(interactions.createdAt))
    .limit(4000)
    .all();

  for (const r of interactionRows) {
    if (r.type === "dislike") {
      dislikedVideoIds.add(r.videoId);
    }
  }

  for (const r of interactionRows) {
    if (r.type === "like") {
      if (!dislikedVideoIds.has(r.videoId)) likedVideoIds.add(r.videoId);
    } else if (r.type === "save") {
      if (!dislikedVideoIds.has(r.videoId)) savedVideoIds.add(r.videoId);
    }
  }

  for (const r of interactionRows) {
    if (r.type !== "like" && r.type !== "save") continue;
    if (!r.channelId || dislikedVideoIds.has(r.videoId)) continue;
    interactionInterestChannelIds.add(r.channelId);
    const ageSec = Math.max(0, nowSec - r.createdAt);
    const base = r.type === "like" ? LIKE_CHANNEL_WEIGHT : SAVE_CHANNEL_WEIGHT;
    const contrib = base * Math.exp(-ageSec / INTERACTION_CHANNEL_TAU_SEC);
    channelWeights.set(
      r.channelId,
      (channelWeights.get(r.channelId) ?? 0) + contrib,
    );
    const prevLw = channelLastWatchedAt.get(r.channelId) ?? 0;
    channelLastWatchedAt.set(r.channelId, Math.max(prevLw, r.createdAt));
  }

  // Queuing a video or filing it into a playlist is an endorsement, so treat it
  // like a save: its title joins the taste corpus (via savedVideoIds) and its
  // channel gains affinity. Saves themselves are handled above; this covers the
  // queue/playlist entries that never wrote a `save` interaction.
  for (const ref of getQueuedAndPlaylistVideoRefs(db, userId)) {
    if (dislikedVideoIds.has(ref.videoId)) continue;
    savedVideoIds.add(ref.videoId);
    if (!ref.channelId) continue;
    interactionInterestChannelIds.add(ref.channelId);
    const ageSec = Math.max(0, nowSec - ref.addedAt);
    const contrib =
      SAVE_CHANNEL_WEIGHT * Math.exp(-ageSec / INTERACTION_CHANNEL_TAU_SEC);
    channelWeights.set(
      ref.channelId,
      (channelWeights.get(ref.channelId) ?? 0) + contrib,
    );
    const prevLw = channelLastWatchedAt.get(ref.channelId) ?? 0;
    channelLastWatchedAt.set(ref.channelId, Math.max(prevLw, ref.addedAt));
  }

  const channelsOrderedByRecentWatch = [...channelLastWatchedAt.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const quickSkipVideoIds = new Set<string>();
  for (const [videoId, engagement] of engagementByVideo) {
    if (engagement !== "skip") continue;
    if (!hasLongFormRow.has(videoId)) continue;
    // A skipped-then-liked/saved video signals interest, not rejection.
    if (likedVideoIds.has(videoId) || savedVideoIds.has(videoId)) continue;
    quickSkipVideoIds.add(videoId);
  }

  return {
    channelWeights,
    totalWatches: rows.length,
    watchedVideoIds,
    watchedVideoLastSeen,
    distinctWatchesByChannel,
    totalDistinctVideosWatched: watchedVideoIds.size,
    channelLastWatchedAt,
    channelsOrderedByRecentWatch,
    historyChannelIds,
    likedVideoIds,
    dislikedVideoIds,
    savedVideoIds,
    interactionInterestChannelIds,
    quickSkipVideoIds,
  };
}
