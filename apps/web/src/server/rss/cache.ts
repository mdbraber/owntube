import { z } from "zod";
import { logger } from "@/lib/logger";
import {
  type LongFormWindow,
  fetchLongFormWindowLive,
} from "@/lib/long-form-uploads";
import type { AppDb } from "@/server/db/client";
import {
  readFreshCacheRow,
  readLatestCacheRow,
  registerInFlight,
  writeCache,
} from "@/server/services/proxy/cache";
import type { UnifiedVideo } from "@/server/services/proxy.types";

/**
 * SQLite-backed cache for youtube.com RSS reads (channel uploads feed and the
 * `UULF…` long-form playlist window). These feeds power the merged
 * subscriptions feed, its published-date patching, Shorts classification, and
 * sidebar recency — before this cache every home-page load re-fetched them
 * live per channel.
 *
 * Read semantics are serve-stale-and-revalidate: interactive requests return
 * the latest cached row immediately (a background single-flight refresh
 * updates it) and only block on the live fetch when a channel has never been
 * cached. The cache warmer force-refreshes every subscription/history channel
 * each cycle, so in steady state the interactive path is SQLite-only.
 */

const rssEntrySchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channelId: z.string(),
  channelName: z.string().optional(),
  thumbnailUrl: z.string(),
  publishedAt: z.number().optional(),
  publishedText: z.string().optional(),
  viewCount: z.number().optional(),
});

const rssPayloadSchema = z.object({ entries: z.array(rssEntrySchema) });

const longFormPayloadSchema = z.object({
  ids: z.array(z.string()),
  oldestPublishedAt: z.number().nullable(),
  newestPublishedAt: z.number().nullable(),
  /** True when the live fetch found no usable window (Shorts-only channel, non-canonical id). */
  missing: z.boolean().optional(),
});

export type RssEntry = z.infer<typeof rssEntrySchema> & UnifiedVideo;

function rssCacheKey(channelId: string): string {
  return `rss:v1:${channelId}`;
}

function longFormCacheKey(channelId: string): string {
  return `rss-uulf:v1:${channelId}`;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Live fetch+parse of a channel's uploads RSS. Returns null on any failure so a stale row survives. */
async function fetchChannelRssLive(
  channelId: string,
): Promise<RssEntry[] | null> {
  try {
    const url = new URL("https://www.youtube.com/feeds/videos.xml");
    url.searchParams.set("channel_id", channelId);
    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const xml = await resp.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
    const out: RssEntry[] = [];
    for (const m of entries) {
      const entry = m[1];
      if (!entry) continue;
      const videoIdRaw = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i)?.[1];
      const titleRaw = entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
      const publishedRaw = entry.match(/<published>([^<]+)<\/published>/i)?.[1];
      const channelNameRaw = entry.match(/<name>([\s\S]*?)<\/name>/i)?.[1];
      const viewsRaw = entry.match(
        /<media:statistics[^>]*\bviews="(\d+)"/i,
      )?.[1];
      if (!videoIdRaw || !titleRaw) continue;
      const videoId = decodeXmlEntities(videoIdRaw.trim());
      const title = decodeXmlEntities(titleRaw.trim());
      const channelName = channelNameRaw
        ? decodeXmlEntities(channelNameRaw.trim())
        : undefined;
      const publishedAtMs = publishedRaw
        ? Date.parse(publishedRaw.trim())
        : Number.NaN;
      const publishedAt = Number.isNaN(publishedAtMs)
        ? undefined
        : Math.floor(publishedAtMs / 1000);
      const viewCount = viewsRaw ? Number.parseInt(viewsRaw, 10) : undefined;
      out.push({
        videoId,
        title,
        channelId,
        channelName,
        thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
        publishedAt,
        publishedText: publishedRaw?.trim(),
        viewCount: Number.isFinite(viewCount) ? viewCount : undefined,
      });
    }
    return out;
  } catch {
    return null;
  }
}

const inFlightRss = new Map<string, Promise<RssEntry[]>>();
const inFlightLongForm = new Map<string, Promise<LongFormWindow | null>>();

export function clearRssInFlight(): void {
  inFlightRss.clear();
  inFlightLongForm.clear();
}

function parseRssRow(payloadJson: string): RssEntry[] | null {
  const parsed = rssPayloadSchema.safeParse(JSON.parse(payloadJson));
  return parsed.success ? parsed.data.entries : null;
}

/**
 * Force a live refresh of a channel's uploads RSS into the cache. Returns the
 * fresh entries; keeps (and returns) the previous row on fetch failure so
 * upstream flakiness never erases data. Used by the warmer and as the
 * revalidation task behind cached reads.
 */
export async function refreshChannelRss(
  db: AppDb,
  channelId: string,
): Promise<RssEntry[]> {
  const key = rssCacheKey(channelId);
  const inFlight = inFlightRss.get(key);
  if (inFlight) return inFlight;
  const task = (async () => {
    const live = await fetchChannelRssLive(channelId);
    if (live !== null) {
      writeCache(db, key, "youtube", { entries: live }, "rss");
      return live;
    }
    logger.warn("rss_cache.refresh_failed", { channelId });
    const row = readLatestCacheRow(db, key);
    return (row && parseRssRow(row.payloadJson)) ?? [];
  })();
  registerInFlight(inFlightRss, key, task);
  return task;
}

/**
 * Channel uploads RSS entries, SQLite-first: fresh row → return; stale row →
 * return immediately and revalidate in the background; no row (never-seen
 * channel) → block on the live fetch once.
 */
export async function getChannelRssEntries(
  db: AppDb,
  channelId: string,
): Promise<RssEntry[]> {
  const key = rssCacheKey(channelId);
  const fresh = readFreshCacheRow(db, key);
  if (fresh) {
    const entries = parseRssRow(fresh.payloadJson);
    if (entries) return entries;
  }
  const stale = readLatestCacheRow(db, key);
  const task = refreshChannelRss(db, channelId);
  if (stale) {
    const entries = parseRssRow(stale.payloadJson);
    if (entries) return entries;
  }
  return task;
}

/** Newest published-at (unix seconds) in the channel's cached RSS, 0 when unknown. */
export async function getChannelRssNewestPublishedAt(
  db: AppDb,
  channelId: string,
): Promise<number> {
  const entries = await getChannelRssEntries(db, channelId);
  let newest = 0;
  for (const e of entries) {
    if (typeof e.publishedAt === "number" && e.publishedAt > newest) {
      newest = e.publishedAt;
    }
  }
  return newest;
}

function parseLongFormRow(payloadJson: string): LongFormWindow | null {
  const parsed = longFormPayloadSchema.safeParse(JSON.parse(payloadJson));
  if (!parsed.success || parsed.data.missing) return null;
  return {
    ids: new Set(parsed.data.ids),
    oldestPublishedAt: parsed.data.oldestPublishedAt,
    newestPublishedAt: parsed.data.newestPublishedAt,
  };
}

/**
 * Force a live refresh of a channel's long-form (`UULF…`) window into the
 * cache. A null live result is cached as `missing` so Shorts-only channels
 * don't get refetched on every read.
 */
export async function refreshLongFormWindow(
  db: AppDb,
  channelId: string,
): Promise<LongFormWindow | null> {
  const key = longFormCacheKey(channelId);
  const inFlight = inFlightLongForm.get(key);
  if (inFlight) return inFlight;
  const task = (async () => {
    const live = await fetchLongFormWindowLive(channelId);
    writeCache(
      db,
      key,
      "youtube",
      live
        ? {
            ids: [...live.ids],
            oldestPublishedAt: live.oldestPublishedAt,
            newestPublishedAt: live.newestPublishedAt,
          }
        : { ids: [], oldestPublishedAt: null, newestPublishedAt: null, missing: true },
      "rss",
    );
    return live;
  })();
  registerInFlight(inFlightLongForm, key, task);
  return task;
}

/** One channel's long-form window, serve-stale-and-revalidate (see module doc). */
export async function getLongFormWindow(
  db: AppDb,
  channelId: string,
): Promise<LongFormWindow | null> {
  const key = longFormCacheKey(channelId);
  const fresh = readFreshCacheRow(db, key);
  if (fresh) return parseLongFormRow(fresh.payloadJson);
  const stale = readLatestCacheRow(db, key);
  const task = refreshLongFormWindow(db, channelId);
  if (stale) return parseLongFormRow(stale.payloadJson);
  return task;
}

/**
 * Cached long-form windows for distinct channels. Same result contract as
 * `fetchLongFormWindows`: channels without a usable window are absent.
 */
export async function getLongFormWindows(
  db: AppDb,
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
    unique.map(async (c) => [c, await getLongFormWindow(db, c)] as const),
  );
  for (const [c, window] of results) {
    if (window) out.set(c, window);
  }
  return out;
}
