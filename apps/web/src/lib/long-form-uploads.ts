/**
 * YouTube exposes a hidden per-channel "long-form videos" playlist whose ID is the
 * channel ID with the leading `UC` swapped for `UULF`. Its RSS feed
 * (`feeds/videos.xml?playlist_id=UULF…`) lists ONLY regular uploads — no Shorts and
 * no live streams — so it is an authoritative allowlist for classifying a channel's
 * recent upload window. This is fetched straight from youtube.com (no googlevideo),
 * so it works from the server without the 403s that hit segment fetches.
 */

/** `UC…` channel ID → its `UULF…` long-form uploads playlist ID, or null if not a canonical channel ID. */
export function longFormUploadsPlaylistId(channelId: string): string | null {
  if (!/^UC[0-9A-Za-z_-]{22}$/.test(channelId)) return null;
  return `UULF${channelId.slice(2)}`;
}

export type LongFormWindow = {
  /** Video IDs of the most recent long-form uploads (RSS caps this at ~15). */
  ids: Set<string>;
  /** Unix seconds of the oldest entry in `ids`; null when no dated entries were parsed. */
  oldestPublishedAt: number | null;
  /** Unix seconds of the newest long-form upload; null when no dated entries were parsed. */
  newestPublishedAt: number | null;
};

async function fetchLongFormWindow(
  channelId: string,
): Promise<LongFormWindow | null> {
  const playlistId = longFormUploadsPlaylistId(channelId);
  if (!playlistId) return null;
  try {
    const url = new URL("https://www.youtube.com/feeds/videos.xml");
    url.searchParams.set("playlist_id", playlistId);
    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const xml = await resp.text();
    const ids = new Set<string>();
    let oldestPublishedAt: number | null = null;
    let newestPublishedAt: number | null = null;
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
      const entry = m[1] ?? "";
      const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i)?.[1]?.trim();
      if (!id) continue;
      ids.add(id);
      const published = entry
        .match(/<published>([^<]+)<\/published>/i)?.[1]
        ?.trim();
      const ms = published ? Date.parse(published) : NaN;
      if (!Number.isNaN(ms)) {
        const sec = Math.floor(ms / 1000);
        if (oldestPublishedAt === null || sec < oldestPublishedAt) {
          oldestPublishedAt = sec;
        }
        if (newestPublishedAt === null || sec > newestPublishedAt) {
          newestPublishedAt = sec;
        }
      }
    }
    if (ids.size === 0) return null;
    return { ids, oldestPublishedAt, newestPublishedAt };
  } catch {
    return null;
  }
}

/**
 * Fetch the long-form upload window for each distinct channel, in parallel.
 * Channels whose playlist RSS fails or is empty are simply absent from the map
 * (callers fall back to the duration/#shorts heuristic for those).
 */
export async function fetchLongFormWindows(
  channelIds: readonly (string | undefined)[],
): Promise<Map<string, LongFormWindow>> {
  const unique = [
    ...new Set(
      channelIds.filter(
        (c): c is string => typeof c === "string" && c.length > 0,
      ),
    ),
  ];
  const out = new Map<string, LongFormWindow>();
  const results = await Promise.all(
    unique.map(async (c) => [c, await fetchLongFormWindow(c)] as const),
  );
  for (const [c, window] of results) {
    if (window) out.set(c, window);
  }
  return out;
}
