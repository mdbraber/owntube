import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { normalizeChannelTag } from "@/lib/channel-tag";
import { stripRestrictedListVideos } from "@/lib/feed-exclude-restricted";
import {
  fetchLongFormWindows,
  type LongFormWindow,
} from "@/lib/long-form-uploads";
import {
  compareSubscriptionHeads,
  newerPublished,
  publishedSortKey,
} from "@/lib/published-sort-key";
import { isStrictShortVideo } from "@/lib/short-video";
import { normalizeYoutubeChannelId } from "@/lib/youtube-channel-id";
import { refreshChannelsLatestVideoAt } from "@/server/channel-meta/recency";
import {
  nowUnix,
  readChannelMetaByIds,
  refreshChannelMetaIfStale,
} from "@/server/channel-meta/store";
import type { AppDb } from "@/server/db/client";
import {
  channelTags,
  interactions,
  subscriptions,
  watchHistory,
} from "@/server/db/schema";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import {
  fetchChannelPage,
  type ProxySourceOverrides,
} from "@/server/services/proxy";
import type {
  ChannelPageResult,
  UnifiedVideo,
} from "@/server/services/proxy.types";
import {
  getUserProxyOverrides,
  getUserSettings,
} from "@/server/settings/profile";
import { reconcileSubscriptionChannelIdsForUser } from "@/server/subscriptions/reconcile-channel-ids";
import {
  protectedProcedure,
  publicProcedure,
  router,
} from "@/server/trpc/init";

const channelIdSchema = z.string().min(1).max(128);
const videoIdSchema = z.string().min(5).max(64);
const tagFilterSchema = z.array(z.string().max(40)).max(64).optional();

function normalizeTagList(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  const out = new Set<string>();
  for (const t of raw) {
    const norm = normalizeChannelTag(t);
    if (norm) out.add(norm);
  }
  return [...out];
}

/**
 * Filter a channel-id list by the user's local tags. A channel is kept when it
 * has none of the excluded tags AND (no include tags are active OR it carries at
 * least one). Untagged channels drop out as soon as any include tag is active.
 */
function filterChannelIdsByTags(
  db: AppDb,
  userId: number,
  channelIds: string[],
  includeTagsRaw: string[] | undefined,
  excludeTagsRaw: string[] | undefined,
): string[] {
  const include = normalizeTagList(includeTagsRaw);
  const exclude = normalizeTagList(excludeTagsRaw);
  if (include.length === 0 && exclude.length === 0) return channelIds;

  const wanted = [...new Set([...include, ...exclude])];
  const rows = db
    .select({ channelId: channelTags.channelId, tag: channelTags.tag })
    .from(channelTags)
    .where(
      and(eq(channelTags.userId, userId), inArray(channelTags.tag, wanted)),
    )
    .all();
  const tagsByChannel = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = tagsByChannel.get(r.channelId);
    if (!set) {
      set = new Set<string>();
      tagsByChannel.set(r.channelId, set);
    }
    set.add(r.tag);
  }

  const includeSet = new Set(include);
  const excludeSet = new Set(exclude);
  return channelIds.filter((id) => {
    const tags = tagsByChannel.get(id);
    if (excludeSet.size > 0 && tags) {
      for (const t of tags) if (excludeSet.has(t)) return false;
    }
    if (includeSet.size > 0) {
      if (!tags) return false;
      for (const t of tags) if (includeSet.has(t)) return true;
      return false;
    }
    return true;
  });
}

/** Avoid hundreds of parallel upstream calls (rate limit → names fall back to raw IDs). */
const LIST_DETAILED_BATCH = 5;
const SIDEBAR_SUBSCRIPTION_LIMIT_DEFAULT = 24;
const SIDEBAR_SUBSCRIPTION_LIMIT_MAX = 50;

type SubscriptionChannelDetail = {
  channelId: string;
  subscribedAt: number;
  channelName: string;
  avatarUrl: string | null;
};

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSubscriptionChannelDetail(
  db: AppDb,
  channelId: string,
  subscribedAt: number,
  overrides: ProxySourceOverrides | undefined,
): Promise<SubscriptionChannelDetail> {
  const meta = await refreshChannelMetaIfStale(db, channelId, overrides);
  return {
    channelId,
    subscribedAt,
    channelName: meta.channelName,
    avatarUrl: meta.avatarUrl,
  };
}

async function listDetailedChannelRows(
  db: AppDb,
  subs: { channelId: string; subscribedAt: number }[],
  overrides: ProxySourceOverrides | undefined,
): Promise<SubscriptionChannelDetail[]> {
  const out: SubscriptionChannelDetail[] = [];
  for (let i = 0; i < subs.length; i += LIST_DETAILED_BATCH) {
    if (i > 0) await sleepMs(80);
    const chunk = subs.slice(i, i + LIST_DETAILED_BATCH);
    const part = await Promise.all(
      chunk.map((s) =>
        fetchSubscriptionChannelDetail(
          db,
          s.channelId,
          s.subscribedAt,
          overrides,
        ),
      ),
    );
    out.push(...part);
  }
  return out;
}

function markWatchedRows(
  db: AppDb,
  userId: number,
  items: { videoId: string; channelId: string }[],
): void {
  const ts = nowUnix();
  for (const item of items) {
    const recent = db
      .select()
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, userId),
          eq(watchHistory.videoId, item.videoId),
          eq(watchHistory.isDeleted, 0),
        ),
      )
      .orderBy(desc(watchHistory.startedAt))
      .limit(1)
      .all()[0];
    if (recent) {
      db.update(watchHistory)
        .set({
          completed: 1,
          createdAt: ts,
        })
        .where(eq(watchHistory.id, recent.id))
        .run();
      continue;
    }
    db.insert(watchHistory)
      .values({
        userId,
        videoId: item.videoId,
        channelId: item.channelId,
        startedAt: ts,
        durationWatched: 0,
        completed: 1,
        isDeleted: 0,
        createdAt: ts,
      })
      .run();
  }
}

async function fetchChannelVideosUpToPages(
  db: Parameters<typeof fetchChannelPage>[0],
  channelId: string,
  overrides: Parameters<typeof fetchChannelPage>[2],
  maxPages: number,
): Promise<UnifiedVideo[]> {
  const out: UnifiedVideo[] = [];
  let continuation: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    let res: ChannelPageResult;
    try {
      // Serve from the warm channel-page cache when fresh; the merge feed already
      // gets each channel's newest upload from the RSS seed, so a slightly stale
      // page (older videos) is fine and avoids a live ~1s Invidious call per channel.
      res = await fetchChannelPage(db, { channelId, continuation }, overrides);
    } catch (e) {
      if (
        e instanceof UpstreamUnavailableError ||
        e instanceof RateLimitExceededError
      ) {
        break;
      }
      throw e;
    }
    out.push(...res.videos);
    if (!res.continuation) break;
    continuation = res.continuation;
  }
  return out;
}

type ChannelBuffer = {
  channelId: string;
  videos: UnifiedVideo[];
  readIdx: number;
  /** `undefined` = first page not fetched yet; `null` = no further pages */
  nextContinuation: string | null | undefined;
};

const MAX_MERGE_CURSOR_OFFSET = 10_000;
const MAX_SORT_PICKS = 50_000;
const RSS_SEED_MAX_CHANNELS = 250;

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchRssEntriesFromChannel(
  channelId: string,
): Promise<UnifiedVideo[]> {
  try {
    const url = new URL("https://www.youtube.com/feeds/videos.xml");
    url.searchParams.set("channel_id", channelId);
    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!resp.ok) return [];
    const xml = await resp.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
    const out: UnifiedVideo[] = [];
    for (const m of entries) {
      const entry = m[1];
      if (!entry) continue;
      const videoIdRaw = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i)?.[1];
      const titleRaw = entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
      const publishedRaw = entry.match(/<published>([^<]+)<\/published>/i)?.[1];
      const channelNameRaw = entry.match(/<name>([\s\S]*?)<\/name>/i)?.[1];
      if (!videoIdRaw || !titleRaw) continue;
      const videoId = decodeXmlEntities(videoIdRaw.trim());
      const title = decodeXmlEntities(titleRaw.trim());
      const channelName = channelNameRaw
        ? decodeXmlEntities(channelNameRaw.trim())
        : undefined;
      const publishedAtMs = publishedRaw
        ? Date.parse(publishedRaw.trim())
        : NaN;
      const publishedAt = Number.isNaN(publishedAtMs)
        ? undefined
        : Math.floor(publishedAtMs / 1000);
      out.push({
        videoId,
        title,
        channelId,
        channelName,
        thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
        publishedAt,
        publishedText: publishedRaw?.trim(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function patchVisibleVideosWithRssDates(
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

  const rssByVideoId = new Map<string, number>();
  const all = await Promise.all(
    channelIds.map((c) => fetchRssEntriesFromChannel(c)),
  );
  for (const list of all) {
    for (const item of list) {
      if (
        typeof item.publishedAt === "number" &&
        Number.isFinite(item.publishedAt)
      ) {
        rssByVideoId.set(item.videoId, item.publishedAt);
      }
    }
  }
  if (rssByVideoId.size === 0) return videos;

  return videos.map((v) => {
    const rssPublishedAt = rssByVideoId.get(v.videoId);
    if (rssPublishedAt === undefined) return v;
    return {
      ...v,
      publishedAt: rssPublishedAt,
      publishedText: new Date(rssPublishedAt * 1000).toISOString(),
    };
  });
}

/** Fills `channelAvatarUrl` / name from `channel_meta` when upstream lists omit them. */
function enrichSubscriptionVideosWithChannelMeta(
  db: AppDb,
  videos: UnifiedVideo[],
): UnifiedVideo[] {
  const channelIds = [
    ...new Set(
      videos
        .map((v) => v.channelId)
        .filter((c): c is string => typeof c === "string" && c.length > 0),
    ),
  ];
  if (channelIds.length === 0) return videos;

  const byId = readChannelMetaByIds(db, channelIds);

  return videos.map((v) => {
    const id = v.channelId;
    if (!id) return v;
    const meta = byId.get(id);
    if (!meta) return v;
    const channelName = v.channelName?.trim()
      ? v.channelName
      : meta.channelName;
    const channelAvatarUrl = v.channelAvatarUrl ?? meta.avatarUrl ?? undefined;
    if (
      channelName === v.channelName &&
      channelAvatarUrl === v.channelAvatarUrl
    ) {
      return v;
    }
    return {
      ...v,
      channelName,
      ...(channelAvatarUrl !== undefined ? { channelAvatarUrl } : {}),
    };
  });
}

function encodeMergedFeedCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, o: offset }), "utf8").toString(
    "base64url",
  );
}

function decodeMergedFeedCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const j = JSON.parse(raw) as { v?: number; o?: number };
    if (j.v !== 1 || typeof j.o !== "number" || !Number.isFinite(j.o)) {
      return 0;
    }
    return Math.min(Math.max(0, Math.floor(j.o)), MAX_MERGE_CURSOR_OFFSET);
  } catch {
    return 0;
  }
}

async function appendNextPageIfNeeded(
  db: AppDb,
  buf: ChannelBuffer,
  overrides: ProxySourceOverrides | undefined,
  rssPublishedByVideoId?: ReadonlyMap<string, number>,
): Promise<void> {
  while (buf.readIdx >= buf.videos.length) {
    if (buf.nextContinuation === null) return;
    try {
      const input =
        buf.nextContinuation === undefined
          ? { channelId: buf.channelId }
          : { channelId: buf.channelId, continuation: buf.nextContinuation };
      // Cache-only: the feed never blocks on a live upstream call. Fresh/stale
      // cached pages plus the RSS seed cover normal loads; an explicit refresh
      // repopulates the cache in bounded parallel. See `refreshFeed`.
      const res = await fetchChannelPage(db, input, overrides, {
        cacheOnly: true,
      });
      buf.nextContinuation = res.continuation ?? null;
      const patched = rssPublishedByVideoId
        ? res.videos.map((v) => {
            const rssPublishedAt = rssPublishedByVideoId.get(v.videoId);
            if (rssPublishedAt === undefined) return v;
            return {
              ...v,
              publishedAt: rssPublishedAt,
              publishedText: new Date(rssPublishedAt * 1000).toISOString(),
            };
          })
        : res.videos;
      buf.videos.push(...patched);
      if (res.videos.length === 0 && buf.nextContinuation === null) return;
    } catch (e) {
      if (
        e instanceof UpstreamUnavailableError ||
        e instanceof RateLimitExceededError
      ) {
        buf.nextContinuation = null;
        return;
      }
      throw e;
    }
  }
}

/** Newest-first merge across channels (assumes each channel list is newest-first). */
async function collectSortedFeedPage(
  db: AppDb,
  channelIds: string[],
  overrides: ProxySourceOverrides | undefined,
  offset: number,
  limit: number,
): Promise<{ videos: UnifiedVideo[]; exhausted: boolean }> {
  const buffers: ChannelBuffer[] = channelIds.map((channelId) => ({
    channelId,
    videos: [],
    readIdx: 0,
    nextContinuation: undefined,
  }));
  const seen = new Set<string>();
  const videos: UnifiedVideo[] = [];
  let uniqueRank = 0;
  let exhausted = false;
  let iter = 0;
  const nowSec = Math.floor(Date.now() / 1000);
  let lastSubscriptionChannelId: string | undefined;
  const rssPublishedByChannel = new Map<string, Map<string, number>>();

  if (offset === 0) {
    const seedTargets = buffers.slice(0, RSS_SEED_MAX_CHANNELS);
    const rssEntries = await Promise.all(
      seedTargets.map((b) => fetchRssEntriesFromChannel(b.channelId)),
    );
    for (let i = 0; i < seedTargets.length; i++) {
      const channelEntries = rssEntries[i] ?? [];
      if (channelEntries.length === 0) continue;
      const byVideoId = new Map<string, number>();
      for (const e of channelEntries) {
        if (
          typeof e.publishedAt === "number" &&
          Number.isFinite(e.publishedAt)
        ) {
          byVideoId.set(e.videoId, e.publishedAt);
        }
      }
      rssPublishedByChannel.set(seedTargets[i].channelId, byVideoId);
      // Seed the full RSS window (~15 newest uploads), not just the latest, so
      // page 1 can be built entirely from RSS with no live channel-page fetch.
      seedTargets[i]?.videos.push(...channelEntries);
    }
  }

  while (videos.length < limit && iter < MAX_SORT_PICKS) {
    iter++;
    await Promise.all(
      buffers.map((b) =>
        appendNextPageIfNeeded(
          db,
          b,
          overrides,
          rssPublishedByChannel.get(b.channelId),
        ),
      ),
    );
    for (const b of buffers) {
      while (b.readIdx < b.videos.length) {
        const head = b.videos[b.readIdx];
        if (head && seen.has(head.videoId)) {
          b.readIdx++;
          continue;
        }
        break;
      }
    }

    const heads: { buf: ChannelBuffer; v: UnifiedVideo }[] = [];
    for (const buf of buffers) {
      if (buf.readIdx >= buf.videos.length) continue;
      const v = buf.videos[buf.readIdx];
      if (!v) {
        buf.readIdx++;
        continue;
      }
      heads.push({ buf, v });
    }

    if (heads.length === 0) {
      exhausted = true;
      break;
    }

    heads.sort((a, b) =>
      compareSubscriptionHeads(
        { subscriptionChannelId: a.buf.channelId, v: a.v },
        { subscriptionChannelId: b.buf.channelId, v: b.v },
        lastSubscriptionChannelId,
        nowSec,
      ),
    );

    const best = heads[0];
    const bestBuf = best.buf;
    const bestV = best.v;

    seen.add(bestV.videoId);
    if (uniqueRank >= offset && videos.length < limit) {
      videos.push(bestV);
    }
    uniqueRank++;
    bestBuf.readIdx++;
    lastSubscriptionChannelId = bestBuf.channelId;

    if (videos.length >= limit) {
      exhausted = false;
      break;
    }
  }

  if (iter >= MAX_SORT_PICKS && videos.length < limit && !exhausted) {
    exhausted = true;
  }

  return { videos, exhausted };
}

/** Bounded-parallel per-fetch timeout so one slow/rate-limited channel can't stall the whole refresh. */
const REFRESH_CONCURRENCY = 8;
const REFRESH_PER_CHANNEL_TIMEOUT_MS = 6000;

/**
 * Repopulate the channel-page cache for a user's subscriptions by live-fetching
 * page 1 of each channel, bounded to `REFRESH_CONCURRENCY` at a time and capped
 * at `REFRESH_PER_CHANNEL_TIMEOUT_MS` each. Failures/timeouts are swallowed — the
 * feed just serves whatever landed in cache. This is the only subscription path
 * that talks to Invidious live; normal feed loads are cache-only.
 */
async function refreshChannelPageCache(
  db: AppDb,
  channelIds: string[],
  overrides: ProxySourceOverrides | undefined,
): Promise<{ refreshed: number }> {
  let cursor = 0;
  let refreshed = 0;
  async function worker(): Promise<void> {
    while (cursor < channelIds.length) {
      const channelId = channelIds[cursor++];
      if (!channelId) continue;
      const fetchDone = fetchChannelPage(db, { channelId }, overrides, {
        bypassChannelCache: true,
      })
        .then(() => {
          refreshed++;
        })
        .catch(() => {});
      await Promise.race([fetchDone, sleepMs(REFRESH_PER_CHANNEL_TIMEOUT_MS)]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(REFRESH_CONCURRENCY, channelIds.length) },
      () => worker(),
    ),
  );
  return { refreshed };
}

/**
 * A subscription-feed video is treated as a Short when the channel's long-form
 * uploads playlist (UULF) — an authoritative, Shorts-free allowlist — is available
 * and the video sits inside that recent window yet is absent from it (this catches
 * long Shorts the duration heuristic misses, with no false positives, since any
 * long-form upload newer than the window's oldest entry would be in the window).
 * Live/upcoming are never hidden (the long-form playlist also omits those). Videos
 * older than the fetched window, or channels with no playlist data, fall back to the
 * duration/#shorts heuristic in `isStrictShortVideo`.
 */
function isSubscriptionShort(
  video: UnifiedVideo,
  windows: ReadonlyMap<string, LongFormWindow>,
): boolean {
  if (video.isLive || video.isUpcoming) return false;
  const window = video.channelId ? windows.get(video.channelId) : undefined;
  if (window) {
    if (window.ids.has(video.videoId)) return false;
    if (
      typeof video.publishedAt === "number" &&
      window.oldestPublishedAt !== null &&
      video.publishedAt >= window.oldestPublishedAt
    ) {
      return true;
    }
  }
  return isStrictShortVideo(video);
}

async function stripShortsFromSubscriptionFeed(
  videos: UnifiedVideo[],
): Promise<UnifiedVideo[]> {
  if (videos.length === 0) return videos;
  const windows = await fetchLongFormWindows(videos.map((v) => v.channelId));
  return videos.filter((v) => !isSubscriptionShort(v, windows));
}

export const subscriptionsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    reconcileSubscriptionChannelIdsForUser(ctx.db, ctx.userId);
    return ctx.db
      .select({
        channelId: subscriptions.channelId,
        subscribedAt: subscriptions.subscribedAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, ctx.userId))
      .orderBy(desc(subscriptions.subscribedAt))
      .all();
  }),

  listDetailed: protectedProcedure
    .input(
      z
        .object({
          /**
           * Max rows from DB (newest subscriptions first). Omit for **all**
           * subscriptions — use on `/subscriptions/channels` only; keep a
           * small limit in the sidebar to avoid huge upstream batches.
           */
          limit: z.number().int().min(1).max(50_000).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit;
      reconcileSubscriptionChannelIdsForUser(ctx.db, ctx.userId);
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      const base = ctx.db
        .select({
          channelId: subscriptions.channelId,
          subscribedAt: subscriptions.subscribedAt,
        })
        .from(subscriptions)
        .where(eq(subscriptions.userId, ctx.userId))
        .orderBy(desc(subscriptions.subscribedAt));
      const subs =
        typeof limit === "number" ? base.limit(limit).all() : base.all();

      return listDetailedChannelRows(ctx.db, subs, overrides);
    }),

  /** OPML export (NewPipe/FreeTube-compatible) — SQLite + `channel_meta` only, no upstream. */
  exportOpml: protectedProcedure.query(({ ctx }) => {
    reconcileSubscriptionChannelIdsForUser(ctx.db, ctx.userId);
    const subs = ctx.db
      .select({ channelId: subscriptions.channelId })
      .from(subscriptions)
      .where(eq(subscriptions.userId, ctx.userId))
      .orderBy(desc(subscriptions.subscribedAt))
      .all();
    const metaById = readChannelMetaByIds(
      ctx.db,
      subs.map((s) => s.channelId),
    );
    const escapeXml = (value: string) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    const outlines = subs.map((s) => {
      const name = escapeXml(
        metaById.get(s.channelId)?.channelName ?? s.channelId,
      );
      const feedUrl = escapeXml(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(s.channelId)}`,
      );
      return `    <outline text="${name}" title="${name}" type="rss" xmlUrl="${feedUrl}" />`;
    });
    const opml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<opml version="1.1">',
      "  <head>",
      "    <title>owntube subscriptions</title>",
      "  </head>",
      "  <body>",
      ...outlines,
      "  </body>",
      "</opml>",
      "",
    ].join("\n");
    return { opml, count: subs.length };
  }),

  /** Sidebar only — SQLite + `channel_meta`, no upstream (keeps home feed batch fast). */
  listSidebar: protectedProcedure
    .input(
      z
        .object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(SIDEBAR_SUBSCRIPTION_LIMIT_MAX)
            .default(SIDEBAR_SUBSCRIPTION_LIMIT_DEFAULT),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? SIDEBAR_SUBSCRIPTION_LIMIT_DEFAULT;
      reconcileSubscriptionChannelIdsForUser(ctx.db, ctx.userId);
      // Order by newest upload first, so ranking must consider every sub (a
      // long-standing channel may have just posted). Cap the scan for safety.
      const subs = ctx.db
        .select({
          channelId: subscriptions.channelId,
          subscribedAt: subscriptions.subscribedAt,
        })
        .from(subscriptions)
        .where(eq(subscriptions.userId, ctx.userId))
        .orderBy(desc(subscriptions.subscribedAt))
        .limit(2000)
        .all();
      const metaById = readChannelMetaByIds(
        ctx.db,
        subs.map((s) => s.channelId),
      );
      const rows = subs.map((s) => {
        const meta = metaById.get(s.channelId);
        return {
          channelId: s.channelId,
          subscribedAt: s.subscribedAt,
          channelName: meta?.channelName ?? s.channelId,
          avatarUrl: meta?.avatarUrl ?? null,
          latestVideoAt: meta?.latestVideoAt ?? null,
        };
      });
      rows.sort(
        (a, b) =>
          (b.latestVideoAt ?? 0) - (a.latestVideoAt ?? 0) ||
          b.subscribedAt - a.subscribedAt,
      );
      return rows.slice(0, limit);
    }),

  /**
   * Backfill sidebar data that only the merged feed used to populate: each
   * channel's newest-upload time (via cheap RSS) for ordering, and name/avatar
   * for any channel that still lacks meta. Idempotent and self-throttling — once
   * a channel has a recency it is skipped — so the sidebar can fire it on mount.
   */
  refreshRecency: protectedProcedure.mutation(async ({ ctx }) => {
    reconcileSubscriptionChannelIdsForUser(ctx.db, ctx.userId);
    const subs = ctx.db
      .select({ channelId: subscriptions.channelId })
      .from(subscriptions)
      .where(eq(subscriptions.userId, ctx.userId))
      .limit(2000)
      .all();
    const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
    const metaById = readChannelMetaByIds(
      ctx.db,
      subs.map((s) => s.channelId),
    );
    let updated = 0;

    // 1. Channels with no meta at all → fetch name + avatar (channel page).
    const missingMeta = subs
      .filter((s) => !metaById.has(s.channelId))
      .slice(0, 20);
    for (let i = 0; i < missingMeta.length; i += LIST_DETAILED_BATCH) {
      await Promise.all(
        missingMeta.slice(i, i + LIST_DETAILED_BATCH).map((s) =>
          refreshChannelMetaIfStale(ctx.db, s.channelId, overrides)
            .then(() => {
              updated++;
            })
            .catch(() => {}),
        ),
      );
    }

    // 2. Newest upload per channel (long-form playlist, Shorts-RSS fallback),
    // capped like the merged-feed seed. Shared with the cache warmer.
    const recencyTargets = subs.slice(0, RSS_SEED_MAX_CHANNELS);
    updated += await refreshChannelsLatestVideoAt(
      ctx.db,
      recencyTargets.map((s) => s.channelId),
    );
    return { updated };
  }),

  status: publicProcedure
    .input(z.object({ channelId: channelIdSchema }))
    .query(async ({ ctx, input }) => {
      if (!ctx.userId) return { subscribed: false as const };
      const raw = input.channelId;
      const canon = normalizeYoutubeChannelId(raw);
      const row = ctx.db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, ctx.userId),
            or(
              eq(subscriptions.channelId, raw),
              eq(subscriptions.channelId, canon),
            ),
          ),
        )
        .limit(1)
        .all()[0];
      return { subscribed: Boolean(row) };
    }),

  add: protectedProcedure
    .input(z.object({ channelId: channelIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const ts = nowUnix();
      const channelId = normalizeYoutubeChannelId(input.channelId);
      ctx.db
        .insert(subscriptions)
        .values({
          userId: ctx.userId,
          channelId,
          subscribedAt: ts,
        })
        .onConflictDoNothing({
          target: [subscriptions.userId, subscriptions.channelId],
        })
        .run();
      // Populate name + avatar now so the sidebar shows them immediately instead
      // of the raw channel id (usually cached already from viewing the channel).
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      await refreshChannelMetaIfStale(ctx.db, channelId, overrides).catch(
        () => {},
      );
      return { ok: true as const };
    }),

  remove: protectedProcedure
    .input(z.object({ channelId: channelIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const raw = input.channelId;
      const canon = normalizeYoutubeChannelId(raw);
      ctx.db
        .delete(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, ctx.userId),
            or(
              eq(subscriptions.channelId, raw),
              eq(subscriptions.channelId, canon),
            ),
          ),
        )
        .run();
      return { ok: true as const };
    }),

  markWatched: protectedProcedure
    .input(
      z.object({
        videoId: videoIdSchema,
        channelId: channelIdSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      markWatchedRows(ctx.db, ctx.userId, [
        { videoId: input.videoId, channelId: input.channelId ?? "unknown" },
      ]);
      return { ok: true as const };
    }),

  markManyWatched: protectedProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              videoId: videoIdSchema,
              channelId: channelIdSchema.optional(),
            }),
          )
          .min(1)
          .max(200),
      }),
    )
    .mutation(({ ctx, input }) => {
      markWatchedRows(
        ctx.db,
        ctx.userId,
        input.items.map((i) => ({
          videoId: i.videoId,
          channelId: i.channelId ?? "unknown",
        })),
      );
      return { ok: true as const };
    }),

  /**
   * User-initiated refresh (button / pull-to-refresh): live-fetch each
   * subscribed channel's newest page in bounded parallel to repopulate the
   * channel-page cache, then the feed refetches from the now-warm cache.
   */
  refreshFeed: protectedProcedure.mutation(async ({ ctx }) => {
    reconcileSubscriptionChannelIdsForUser(ctx.db, ctx.userId);
    const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
    const subs = ctx.db
      .select({ channelId: subscriptions.channelId })
      .from(subscriptions)
      .where(eq(subscriptions.userId, ctx.userId))
      .orderBy(desc(subscriptions.subscribedAt))
      .all();
    const { refreshed } = await refreshChannelPageCache(
      ctx.db,
      subs.map((s) => s.channelId),
      overrides,
    );
    return { ok: true as const, refreshed, refreshedAt: nowUnix() };
  }),

  /**
   * All uploads from subscribed channels (up to `pagesPerChannel` per
   * channel), de-duplicated and sorted by release date (newest first).
   */
  mergedFeed: protectedProcedure
    .input(
      z
        .object({
          pagesPerChannel: z.number().int().min(1).max(10).default(3),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const pagesPerChannel = input?.pagesPerChannel ?? 3;
      reconcileSubscriptionChannelIdsForUser(ctx.db, ctx.userId);
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      const subs = ctx.db
        .select({ channelId: subscriptions.channelId })
        .from(subscriptions)
        .where(eq(subscriptions.userId, ctx.userId))
        .orderBy(desc(subscriptions.subscribedAt))
        .all();

      const nowSec = Math.floor(Date.now() / 1000);

      const perChannel = await Promise.all(
        subs.map(async (s) => {
          const videos = await fetchChannelVideosUpToPages(
            ctx.db,
            s.channelId,
            overrides,
            pagesPerChannel,
          );
          return { channelId: s.channelId, videos };
        }),
      );

      const byId = new Map<string, UnifiedVideo>();
      for (const row of perChannel) {
        for (const v of row.videos) {
          const prev = byId.get(v.videoId);
          if (
            !prev ||
            publishedSortKey(v, nowSec) > publishedSortKey(prev, nowSec)
          ) {
            byId.set(v.videoId, v);
          }
        }
      }
      const videos = enrichSubscriptionVideosWithChannelMeta(
        ctx.db,
        [...byId.values()].sort((a, b) => newerPublished(a, b, nowSec)),
      );
      const settings = getUserSettings(ctx.db, ctx.userId);

      const restrictedFiltered = settings.hideRestrictedVideos
        ? stripRestrictedListVideos(videos)
        : videos;
      return {
        videos: settings.hideShortsInSubscriptions
          ? await stripShortsFromSubscriptionFeed(restrictedFiltered)
          : restrictedFiltered,
      };
    }),

  /** Paginated merged uploads for infinite scroll (`cursor` = pageParam from tRPC). */
  mergedFeedInfinite: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(8).max(48).default(24),
        cursor: z.string().max(512).optional().nullable(),
        direction: z.enum(["forward", "backward"]).optional(),
        refreshToken: z.number().optional(),
        includeTags: tagFilterSchema,
        excludeTags: tagFilterSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      void input.direction;
      void input.refreshToken;
      const limit = input.limit;
      const offset = decodeMergedFeedCursor(input.cursor);
      reconcileSubscriptionChannelIdsForUser(ctx.db, ctx.userId);
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      const subs = ctx.db
        .select({ channelId: subscriptions.channelId })
        .from(subscriptions)
        .where(eq(subscriptions.userId, ctx.userId))
        .orderBy(desc(subscriptions.subscribedAt))
        .all();

      const channelIds = filterChannelIdsByTags(
        ctx.db,
        ctx.userId,
        subs.map((s) => s.channelId),
        input.includeTags,
        input.excludeTags,
      );

      if (channelIds.length === 0) {
        return {
          videos: [] as UnifiedVideo[],
          nextCursor: null as string | null,
        };
      }

      const { videos, exhausted } = await collectSortedFeedPage(
        ctx.db,
        channelIds,
        overrides,
        offset,
        limit,
      );
      const patchedVideos = await patchVisibleVideosWithRssDates(videos);
      const nowSec = Math.floor(Date.now() / 1000);
      const sortedPatchedVideos = [...patchedVideos].sort((a, b) =>
        newerPublished(a, b, nowSec),
      );
      const withMeta = enrichSubscriptionVideosWithChannelMeta(
        ctx.db,
        sortedPatchedVideos,
      );
      const settings = getUserSettings(ctx.db, ctx.userId);
      const restrictedFiltered = settings.hideRestrictedVideos
        ? stripRestrictedListVideos(withMeta)
        : withMeta;
      const visibleVideos = settings.hideShortsInSubscriptions
        ? await stripShortsFromSubscriptionFeed(restrictedFiltered)
        : restrictedFiltered;
      const candidateVideoIds = visibleVideos.map((v) => v.videoId);
      const ignoredRows =
        candidateVideoIds.length > 0
          ? ctx.db
              .select({ videoId: interactions.videoId })
              .from(interactions)
              .where(
                and(
                  eq(interactions.userId, ctx.userId),
                  eq(interactions.type, "ignore"),
                  inArray(interactions.videoId, candidateVideoIds),
                ),
              )
              .all()
          : [];
      const ignoredSet = new Set(ignoredRows.map((r) => r.videoId));
      const keptVideos = visibleVideos.filter(
        (v) => !ignoredSet.has(v.videoId),
      );
      const visibleVideoIds = keptVideos.map((v) => v.videoId);
      const watchedRows =
        visibleVideoIds.length > 0
          ? ctx.db
              .select({ videoId: watchHistory.videoId })
              .from(watchHistory)
              .where(
                and(
                  eq(watchHistory.userId, ctx.userId),
                  eq(watchHistory.isDeleted, 0),
                  inArray(watchHistory.videoId, visibleVideoIds),
                ),
              )
              .all()
          : [];
      const watchedSet = new Set(watchedRows.map((r) => r.videoId));
      const visibleWithWatchState = keptVideos.map((v) => ({
        ...v,
        watched: watchedSet.has(v.videoId),
      }));

      const gotFullPage = withMeta.length === limit;
      const nextCursor =
        !exhausted && gotFullPage
          ? encodeMergedFeedCursor(offset + withMeta.length)
          : null;

      return { videos: visibleWithWatchState, nextCursor };
    }),
});
