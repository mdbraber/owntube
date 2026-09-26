import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { logger } from "@/lib/logger";
import {
  fetchLongFormWindowLive,
  type LongFormWindow,
} from "@/lib/long-form-uploads";
import type { AppDb } from "@/server/db/client";
import { websubPushed } from "@/server/db/schema";
import {
  nowUnix,
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
        thumbnailUrl: thumbnailFor(videoId),
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

/**
 * How long a WebSub push is held for the live RSS to catch up. Past this it
 * is dropped either way — a video still absent by then was made private,
 * scheduled, or otherwise isn't going to appear.
 */
export const WEBSUB_PUSH_HOLD_SEC = 6 * 3600;

function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

/**
 * Overlay a channel's pending WebSub pushes (`websub_pushed`) on its RSS
 * entries: pushed uploads the feed doesn't list yet are added, tombstoned
 * videos removed. When `live` is true the entries are a fresh youtube.com read,
 * so pushes it now contains are resolved (deleted); pushes past the hold
 * window go either way.
 */
export function mergeWebSubPushes(
  db: AppDb,
  channelId: string,
  entries: RssEntry[],
  live: boolean,
): RssEntry[] {
  const rows = db
    .select()
    .from(websubPushed)
    .where(eq(websubPushed.channelId, channelId))
    .all();
  if (rows.length === 0) return entries;

  const listed = new Set(entries.map((e) => e.videoId));
  const expiredBefore = nowUnix() - WEBSUB_PUSH_HOLD_SEC;
  const done: string[] = [];
  const added: RssEntry[] = [];
  const tombstoned = new Set<string>();
  for (const row of rows) {
    if (row.receivedAt < expiredBefore) {
      done.push(row.videoId);
    } else if (row.deleted) {
      tombstoned.add(row.videoId);
    } else if (listed.has(row.videoId)) {
      if (live) done.push(row.videoId);
    } else {
      added.push({
        videoId: row.videoId,
        title: row.title ?? "",
        channelId,
        channelName: row.channelName ?? undefined,
        thumbnailUrl: thumbnailFor(row.videoId),
        publishedAt: row.publishedAt ?? undefined,
      });
    }
  }
  if (done.length > 0) {
    db.delete(websubPushed).where(inArray(websubPushed.videoId, done)).run();
  }
  if (added.length === 0 && tombstoned.size === 0) return entries;
  return [...added, ...entries]
    .filter((e) => !tombstoned.has(e.videoId))
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}

function parseRssRow(payloadJson: string): RssEntry[] | null {
  const parsed = rssPayloadSchema.safeParse(JSON.parse(payloadJson));
  return parsed.success ? parsed.data.entries : null;
}

/**
 * Force a live refresh of a channel's uploads RSS into the cache. Returns the
 * fresh entries; keeps (and returns) the previous row on fetch failure so
 * upstream flakiness never erases data. Used by the warmer and as the
 * revalidation task behind cached reads. Pending WebSub pushes are overlaid
 * either way (see `mergeWebSubPushes`).
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
      const entries = mergeWebSubPushes(db, channelId, live, true);
      writeCache(db, key, "youtube", { entries }, "rss");
      return entries;
    }
    logger.warn("rss_cache.refresh_failed", { channelId });
    const row = readLatestCacheRow(db, key);
    const stale = (row && parseRssRow(row.payloadJson)) ?? [];
    const entries = mergeWebSubPushes(db, channelId, stale, false);
    // Keep the stale row's age (so it still revalidates) unless a push changed it.
    if (entries !== stale) writeCache(db, key, "youtube", { entries }, "rss");
    return entries;
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
        : {
            ids: [],
            oldestPublishedAt: null,
            newestPublishedAt: null,
            missing: true,
          },
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
