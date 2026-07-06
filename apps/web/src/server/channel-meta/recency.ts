import { fetchLongFormWindows } from "@/lib/long-form-uploads";
import { setChannelLatestVideoAt } from "@/server/channel-meta/store";
import type { AppDb } from "@/server/db/client";

/**
 * Newest `<published>` timestamp (unix seconds) across a channel's RSS feed.
 * Channel RSS *includes* Shorts, so this is the fallback recency signal for
 * Shorts-only channels that have no long-form (`UULF`) uploads playlist.
 * Returns 0 when the feed can't be fetched or has no dated entries.
 */
async function fetchChannelRssNewestPublishedAt(
  channelId: string,
): Promise<number> {
  try {
    const url = new URL("https://www.youtube.com/feeds/videos.xml");
    url.searchParams.set("channel_id", channelId);
    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!resp.ok) return 0;
    const xml = await resp.text();
    let newest = 0;
    for (const m of xml.matchAll(/<published>([^<]+)<\/published>/gi)) {
      const ms = Date.parse((m[1] ?? "").trim());
      if (!Number.isNaN(ms)) {
        const sec = Math.floor(ms / 1000);
        if (sec > newest) newest = sec;
      }
    }
    return newest;
  } catch {
    return 0;
  }
}

/**
 * Refresh each channel's `latest_video_at` used for subscription ordering.
 * Prefers the long-form uploads playlist (excludes Shorts/premieres); channels
 * with no long-form window fall back to their (Shorts-inclusive) channel RSS so
 * Shorts-only channels still sort by their newest upload. Authoritative
 * overwrite. Returns the number of channels whose recency was set.
 *
 * Shared by the subscriptions `refreshRecency` mutation and the cache warmer.
 */
export async function refreshChannelsLatestVideoAt(
  db: AppDb,
  channelIds: readonly string[],
): Promise<number> {
  if (channelIds.length === 0) return 0;
  let updated = 0;

  const windows = await fetchLongFormWindows(channelIds);
  const noLongForm: string[] = [];
  for (const channelId of channelIds) {
    const newest = windows.get(channelId)?.newestPublishedAt;
    if (typeof newest === "number" && newest > 0) {
      setChannelLatestVideoAt(db, channelId, newest);
      updated++;
    } else {
      noLongForm.push(channelId);
    }
  }

  if (noLongForm.length > 0) {
    const newestByChannel = await Promise.all(
      noLongForm.map((channelId) =>
        fetchChannelRssNewestPublishedAt(channelId),
      ),
    );
    for (let i = 0; i < noLongForm.length; i++) {
      const newest = newestByChannel[i] ?? 0;
      if (newest > 0) {
        setChannelLatestVideoAt(db, noLongForm[i], newest);
        updated++;
      }
    }
  }

  return updated;
}
