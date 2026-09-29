import type { AppDb } from "@/server/db/client";
import { type RssEntry, readChannelRssSnapshot } from "@/server/rss/cache";
import type { UnifiedVideo } from "@/server/services/proxy.types";

/**
 * How long after a video is published its absence from the channel's RSS still
 * proves nothing. YouTube adds a public upload to the feed within minutes; an
 * hour is generous, and only delays hiding a members-only video, never shows a
 * wrong one.
 */
export const MEMBERS_ONLY_GRACE_SEC = 60 * 60;

type RssSnapshot = { entries: RssEntry[]; fetchedAt: number };

/**
 * Whether a channel-list video is members-only, going by the one signal
 * Invidious leaves: it lists such videos like any other, with `viewCount: 0`,
 * but YouTube publishes neither their view count nor them in the uploads RSS.
 * Opening one answers "Join this channel to get access to members-only
 * content", and a membership doesn't help — this server fetches anonymously.
 *
 * Zero views alone isn't enough (a public upload can sit at zero for a moment),
 * and absence from the RSS alone isn't either (the feed holds only the newest
 * uploads, and the cached copy can be older than the video). Both together are,
 * provided the feed was fetched well after the video appeared and the video
 * falls inside the window the feed covers. Anything we can't judge is kept.
 */
export function isLikelyMembersOnly(
  video: UnifiedVideo,
  rss: RssSnapshot | null,
): boolean {
  if (video.isLive || video.isUpcoming) return false;
  if ((video.viewCount ?? 0) > 0) return false;
  const published = video.publishedAt;
  if (typeof published !== "number" || !Number.isFinite(published)) {
    return false;
  }
  if (!rss || rss.entries.length === 0) return false;
  if (rss.entries.some((e) => e.videoId === video.videoId)) return false;
  // The feed may simply predate the upload.
  if (published > rss.fetchedAt - MEMBERS_ONLY_GRACE_SEC) return false;
  // Older than everything in the feed: it may just have scrolled out of it.
  const oldest = Math.min(
    ...rss.entries.map((e) =>
      typeof e.publishedAt === "number"
        ? e.publishedAt
        : Number.POSITIVE_INFINITY,
    ),
  );
  if (!Number.isFinite(oldest) || published < oldest) return false;
  return true;
}

/**
 * Drops members-only videos from a subscriptions page. Reads the RSS already
 * cached by the date patch, so it costs no upstream request.
 */
export function dropMembersOnlyVideos<T extends UnifiedVideo>(
  db: AppDb,
  videos: T[],
): T[] {
  const snapshots = new Map<string, RssSnapshot | null>();
  const snapshotFor = (channelId: string) => {
    if (!snapshots.has(channelId)) {
      snapshots.set(channelId, readChannelRssSnapshot(db, channelId));
    }
    return snapshots.get(channelId) ?? null;
  };
  return videos.filter(
    (v) => !(v.channelId && isLikelyMembersOnly(v, snapshotFor(v.channelId))),
  );
}
