import type { AppDb } from "@/server/db/client";
import { getChannelRssEntries } from "@/server/rss/cache";
import { fetchVideoDetail } from "@/server/services/proxy";
import type { UnifiedVideo } from "@/server/services/proxy.types";

/**
 * Correct a list of videos against their channels' uploads RSS.
 *
 * Invidious' channel listing does not carry real publish dates: it derives
 * `published` from YouTube's coarse relative text ("2 weeks ago") at request
 * time, so every row in one response shares the same time-of-day and is only
 * accurate to the granularity of that text. When the text itself degenerates
 * ("0 seconds ago") the video lands on *now*, which reads as "just uploaded"
 * and keeps resetting every time the cache refreshes. Those same rows report
 * `viewCount: 0`, while the single-video endpoint and the RSS both have the
 * real count.
 *
 * Measured across 22 subscribed channels (2026-09-30): 2 of 224 public videos
 * came back from the listing as "0 seconds ago" with 0 views — among them
 * James Hoffmann's `Iq34gq2ihMk` (449,214 views per the RSS), which had shown
 * the same symptom on 2026-09-05.
 *
 * RSS is authoritative for both fields and covers a channel's ~15 newest
 * uploads — exactly the head of a subscriptions feed or a channel page. Older
 * rows with the same failure are repaired from the single-video endpoint
 * instead (see `repairBrokenRowsFromDetail`).
 */
export async function patchVideosWithChannelRss(
  db: AppDb,
  videos: UnifiedVideo[],
): Promise<UnifiedVideo[]> {
  return repairBrokenRowsFromDetail(db, await patchFromRss(db, videos));
}

async function patchFromRss(
  db: AppDb,
  videos: UnifiedVideo[],
): Promise<UnifiedVideo[]> {
  const channelIds = Array.from(
    new Set(
      videos
        .map((v) => v.channelId)
        .filter((c): c is string => typeof c === "string" && c.length > 0),
    ),
  );
  if (channelIds.length === 0 || videos.length === 0) return videos;

  const rssByVideoId = new Map<
    string,
    { publishedAt: number; channelName?: string; viewCount?: number }
  >();
  const all = await Promise.all(
    channelIds.map((c) => getChannelRssEntries(db, c)),
  );
  for (const list of all) {
    for (const item of list) {
      if (
        typeof item.publishedAt === "number" &&
        Number.isFinite(item.publishedAt)
      ) {
        rssByVideoId.set(item.videoId, {
          publishedAt: item.publishedAt,
          channelName: item.channelName,
          viewCount: item.viewCount,
        });
      }
    }
  }
  if (rssByVideoId.size === 0) return videos;

  return videos.map((v) => {
    const rss = rssByVideoId.get(v.videoId);
    if (rss === undefined) return v;
    return {
      ...v,
      publishedAt: rss.publishedAt,
      publishedText: new Date(rss.publishedAt * 1000).toISOString(),
      // Fill only what the listing failed to give. A real count from it is
      // fresher than the RSS (which lags by minutes), so it wins; a missing or
      // zero one is the failure mode described above.
      viewCount:
        typeof v.viewCount === "number" && v.viewCount > 0
          ? v.viewCount
          : typeof rss.viewCount === "number" && rss.viewCount > 0
            ? rss.viewCount
            : v.viewCount,
      // A freshly-subscribed channel has no channel_meta row yet, so its
      // upstream video list may omit the name and the UI falls back to the raw
      // UC id. The RSS feed carries the author name — use it as a fallback.
      channelName:
        v.channelName && v.channelName.trim().length > 0
          ? v.channelName
          : (rss.channelName ?? v.channelName),
    };
  });
}

/** Invidious' text for a row whose date it failed to parse. */
const BROKEN_DATE_TEXT = /^0 seconds? ago$/i;

/**
 * A listing row that still carries the failure after the RSS pass: zero views
 * and "0 seconds ago". The RSS only reaches a channel's newest uploads, so this
 * is an older video — City Planner Plays' `yUM_QMlRXX8`, five months old with
 * 364K views, came back that way.
 *
 * Members-only uploads also list with zero views, but with an ordinary date
 * ("1 week ago"), so they don't match. That matters: the single-video endpoint
 * answers them with an error, and asking again on every page view would only
 * spend the upstream budget. Measured across 22 channels on 2026-09-30, the
 * two kinds didn't overlap: every zero-view row with an ordinary date was
 * members-only, and every "0 seconds ago" one was public.
 */
function isBrokenListingRow(v: UnifiedVideo): boolean {
  if (v.isLive || v.isUpcoming) return false;
  if ((v.viewCount ?? 0) > 0) return false;
  return (
    typeof v.publishedText === "string" &&
    BROKEN_DATE_TEXT.test(v.publishedText.trim())
  );
}

/**
 * Take the date and view count of broken rows from the single-video endpoint.
 * Rare — about one row in a hundred — and `fetchVideoDetail` caches, so this
 * costs one upstream request per broken video, not one per page view. A row
 * whose detail can't be had (rate limit, upstream down) is left as it was.
 */
async function repairBrokenRowsFromDetail(
  db: AppDb,
  videos: UnifiedVideo[],
): Promise<UnifiedVideo[]> {
  if (!videos.some(isBrokenListingRow)) return videos;
  return Promise.all(
    videos.map(async (v) => {
      if (!isBrokenListingRow(v)) return v;
      try {
        const detail = await fetchVideoDetail(db, { videoId: v.videoId });
        const publishedAt = detail.publishedAt;
        return {
          ...v,
          ...(typeof publishedAt === "number" && publishedAt > 0
            ? {
                publishedAt,
                publishedText: new Date(publishedAt * 1000).toISOString(),
              }
            : {}),
          ...(typeof detail.viewCount === "number" && detail.viewCount > 0
            ? { viewCount: detail.viewCount }
            : {}),
        };
      } catch {
        return v;
      }
    }),
  );
}
