import { eq } from "drizzle-orm";
import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import { mergeActiveLiveVideosFirst } from "@/lib/live-video";
import { logger } from "@/lib/logger";
import { sortVideosNewestFirst } from "@/lib/published-sort-key";
import {
  invidiousItemIsStrictShort,
  isStrictShortVideo,
  pipedItemIsStrictShort,
} from "@/lib/short-video";
import { preferHighResVideoThumbnailUrl } from "@/lib/video-thumbnail-url";
import type { AppDb } from "@/server/db/client";
import { channelIdAliases } from "@/server/db/schema";
import {
  channelCacheKey,
  readFreshCacheRow,
  readLatestCacheRow,
  registerInFlight,
  writeCache,
} from "@/server/services/proxy/cache";
import {
  type ProxySourceOverrides,
  resolveProxyBaseCandidates,
} from "@/server/services/proxy/config";
import {
  recordUpstreamFailure,
  throwIfUpstreamFailed,
} from "@/server/services/proxy/errors";
import { FETCH_TIMEOUT_MS, fetchJson } from "@/server/services/proxy/http";
import { mapInvidiousItem } from "@/server/services/proxy/mappers/invidious";
import {
  mapPipedItem,
  pipedListItemsFromPayload,
  pipedRootItems,
} from "@/server/services/proxy/mappers/piped";
import {
  liveUpstreamSource,
  normalizeBaseUrl,
  resolveInvidiousAbsoluteMediaUrl,
  resolveInvidiousThumbnail,
} from "@/server/services/proxy/normalize";
import {
  type ChannelPageInput,
  type ChannelPageResult,
  cachedChannelPayloadSchema,
  channelPageResultSchema,
  type UnifiedVideo,
  unifiedVideoSchema,
} from "@/server/services/proxy.types";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";
import { upstreamGetText } from "@/server/services/upstream-get";

export type FetchChannelPageOptions = {
  /** Force a live upstream read instead of using the fresh channel cache row. */
  bypassChannelCache?: boolean;
  /**
   * Never call upstream. Serve the fresh cache row, else the latest stale row,
   * else an empty page. Keeps the subscriptions feed off the slow serialized
   * live-fetch path; an explicit refresh (`bypassChannelCache`) repopulates the
   * cache in bounded parallel instead.
   */
  cacheOnly?: boolean;
};

const inFlightChannel = new Map<string, Promise<ChannelPageResult>>();

export function clearChannelInFlight(): void {
  inFlightChannel.clear();
}

function readFreshChannelCache(
  db: AppDb,
  key: string,
): ChannelPageResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedChannelPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: false,
  };
}

function readStaleChannelCache(
  db: AppDb,
  key: string,
): ChannelPageResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedChannelPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function buildPipedChannelUrl(base: string, channelId: string): string {
  return new URL(
    `/channel/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  ).toString();
}

function buildPipedChannelNextUrl(
  base: string,
  channelId: string,
  continuation: string,
): string {
  const u = new URL(
    `/nextpage/channel/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  );
  u.searchParams.set("nextpage", continuation);
  return u.toString();
}

function buildInvidiousChannelMetaUrl(base: string, channelId: string): string {
  return new URL(
    `/api/v1/channels/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  ).toString();
}

function buildInvidiousChannelVideosUrl(
  base: string,
  channelId: string,
  continuation?: string,
): string {
  const u = new URL(
    `/api/v1/channels/${encodeURIComponent(channelId)}/videos`,
    `${normalizeBaseUrl(base)}/`,
  );
  if (continuation) u.searchParams.set("continuation", continuation);
  return u.toString();
}

function buildInvidiousChannelShortsUrl(
  base: string,
  channelId: string,
  continuation?: string,
): string {
  const u = new URL(
    `/api/v1/channels/${encodeURIComponent(channelId)}/shorts`,
    `${normalizeBaseUrl(base)}/`,
  );
  if (continuation) u.searchParams.set("continuation", continuation);
  return u.toString();
}

function buildInvidiousChannelStreamsUrl(
  base: string,
  channelId: string,
): string {
  const u = new URL(
    `/api/v1/channels/${encodeURIComponent(channelId)}/streams`,
    `${normalizeBaseUrl(base)}/`,
  );
  u.searchParams.set("sort_by", "newest");
  return u.toString();
}

const PIPED_CHANNEL_LIVE_TAB_NAMES = new Set([
  "live",
  "streams",
  "livestreams",
  "live streams",
]);

async function fetchPipedChannelLiveTabVideos(
  pipedBase: string,
  channelId: string,
  channelPayload: unknown,
): Promise<UnifiedVideo[]> {
  if (!channelPayload || typeof channelPayload !== "object") return [];
  const tabs = (channelPayload as Record<string, unknown>).tabs;
  if (!Array.isArray(tabs)) return [];
  const out: UnifiedVideo[] = [];
  for (const tab of tabs) {
    if (!tab || typeof tab !== "object") continue;
    const t = tab as Record<string, unknown>;
    const tabName = typeof t.name === "string" ? t.name.toLowerCase() : "";
    if (!PIPED_CHANNEL_LIVE_TAB_NAMES.has(tabName)) continue;
    const data = typeof t.data === "string" ? t.data : null;
    if (!data) continue;
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(buildPipedChannelTabsUrl(pipedBase, data));
      out.push(
        ...videosFromPipedListItems(
          pipedListItemsFromPayload(json),
          pipedBase,
          channelId,
          { excludeShorts: true },
        ),
      );
    } catch (e) {
      logger.warn("proxy.piped.channel_live_tab_failed", {
        channelId,
        tab: tabName,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

async function fetchInvidiousChannelLiveStreams(
  invidiousBase: string,
  channelId: string,
): Promise<UnifiedVideo[]> {
  try {
    acquireUpstreamSlot();
    const json = await fetchJson(
      buildInvidiousChannelStreamsUrl(invidiousBase, channelId),
    );
    const parsed = parseInvidiousChannelVideosContinuation(
      json,
      channelId,
      invidiousBase,
    );
    return parsed?.videos ?? [];
  } catch (e) {
    logger.warn("proxy.invidious.channel_streams_failed", {
      channelId,
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

async function enrichChannelVideosWithLiveStreams(
  videos: UnifiedVideo[],
  channelId: string,
  opts: {
    pipedBase?: string;
    invidiousBase?: string;
    sourceUsed: ChannelPageResult["sourceUsed"];
    pipedChannelPayload?: unknown;
  },
): Promise<UnifiedVideo[]> {
  const { pipedBase, invidiousBase, sourceUsed, pipedChannelPayload } = opts;
  if (sourceUsed === "cache") return videos;
  let liveCandidates: UnifiedVideo[] = [];
  if (sourceUsed === "piped" && pipedBase) {
    try {
      let payload = pipedChannelPayload;
      if (!payload) {
        acquireUpstreamSlot();
        payload = await fetchJson(buildPipedChannelUrl(pipedBase, channelId));
      }
      liveCandidates = await fetchPipedChannelLiveTabVideos(
        pipedBase,
        channelId,
        payload,
      );
    } catch (e) {
      logger.warn("proxy.piped.channel_live_enrich_failed", {
        channelId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  } else if (sourceUsed === "invidious" && invidiousBase) {
    liveCandidates = await fetchInvidiousChannelLiveStreams(
      invidiousBase,
      channelId,
    );
  }
  return mergeActiveLiveVideosFirst(videos, liveCandidates);
}

function buildPipedChannelVideosSearchUrl(base: string, query: string): string {
  const u = new URL("/search", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("q", query);
  u.searchParams.set("filter", "videos");
  return u.toString();
}

function buildPipedChannelTabsUrl(base: string, tabData: string): string {
  const u = new URL("/channels/tabs", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("data", tabData);
  return u.toString();
}

function buildInvidiousChannelRssUrl(base: string, channelId: string): string {
  return new URL(
    `/feed/channel/${encodeURIComponent(channelId)}`,
    `${normalizeBaseUrl(base)}/`,
  ).toString();
}

function buildInvidiousChannelVideosSearchUrl(
  base: string,
  query: string,
): string {
  const u = new URL("/api/v1/search", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("q", query);
  u.searchParams.set("type", "video");
  u.searchParams.set("sort_by", "upload_date");
  return u.toString();
}

function filterVideosForChannel(
  videos: UnifiedVideo[],
  channelId: string,
): UnifiedVideo[] {
  return videos.filter((v) => !v.channelId || v.channelId === channelId);
}

const pipedItemIsShort = pipedItemIsStrictShort;
const unifiedVideoIsLikelyShort = isStrictShortVideo;
const invidiousItemIsShort = invidiousItemIsStrictShort;

function videosFromPipedListItems(
  items: unknown[],
  pipedBase: string,
  channelId: string,
  opts?: { excludeShorts?: boolean; shortsOnly?: boolean },
): UnifiedVideo[] {
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const isShort = pipedItemIsShort(item);
    if (opts?.excludeShorts && isShort) continue;
    if (opts?.shortsOnly && !isShort) continue;
    const v = mapPipedItem(item, pipedBase);
    if (!v) continue;
    if (v.channelId && v.channelId !== channelId) continue;
    if (opts?.excludeShorts && unifiedVideoIsLikelyShort(v)) continue;
    if (opts?.shortsOnly && !unifiedVideoIsLikelyShort(v)) continue;
    videos.push(v);
  }
  return videos;
}

function extractXmlTagContent(
  block: string,
  tagName: string,
): string | undefined {
  const re = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    "i",
  );
  const m = re.exec(block);
  if (!m) return undefined;
  return m[1]
    ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function extractXmlAttr(
  block: string,
  tagName: string,
  attr: string,
): string | undefined {
  const re = new RegExp(`<${tagName}[^>]*\\s${attr}=["']([^"']+)["']`, "i");
  return re.exec(block)?.[1];
}

/** Invidious `/feed/channel/…` when `/videos` returns parse-error placeholders. */
function parseInvidiousChannelRssFeed(
  xml: string,
  channelId: string,
  invidiousBase: string,
  channelName?: string,
): UnifiedVideo[] {
  const videos: UnifiedVideo[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null = entryRe.exec(xml);
  while (match !== null) {
    const block = match[1] ?? "";
    const videoId =
      extractXmlTagContent(block, "yt:videoId") ??
      extractXmlTagContent(block, "videoId");
    const title = extractXmlTagContent(block, "title");
    if (!videoId || !title) {
      match = entryRe.exec(xml);
      continue;
    }
    const publishedRaw = extractXmlTagContent(block, "published");
    let publishedAt: number | undefined;
    if (publishedRaw) {
      const ms = Date.parse(publishedRaw);
      if (Number.isFinite(ms)) publishedAt = Math.floor(ms / 1000);
    }
    const thumbRaw =
      extractXmlAttr(block, "media:thumbnail", "url") ??
      extractXmlAttr(block, "media\\:thumbnail", "url");
    const thumbnailUrl = thumbRaw
      ? preferHighResVideoThumbnailUrl(
          resolveInvidiousAbsoluteMediaUrl(thumbRaw, invidiousBase),
          videoId,
        )
      : undefined;
    const name =
      extractXmlTagContent(block, "name") ?? channelName ?? undefined;
    const parsed = unifiedVideoSchema.safeParse({
      videoId,
      title,
      channelId,
      channelName: name,
      thumbnailUrl,
      publishedAt,
    });
    if (parsed.success) videos.push(parsed.data);
    match = entryRe.exec(xml);
  }
  return videos;
}

async function tryPipedChannelVideoFallbacks(
  pipedBase: string,
  channelId: string,
  initialPayload: unknown,
  channelName: string,
): Promise<UnifiedVideo[]> {
  const seen = new Set<string>();
  const out: UnifiedVideo[] = [];
  const push = (list: UnifiedVideo[]) => {
    for (const v of list) {
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      out.push(v);
      if (out.length >= 60) return;
    }
  };

  const nextpage = pipedChannelNextContinuation(initialPayload);
  if (nextpage) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildPipedChannelNextUrl(pipedBase, channelId, nextpage),
      );
      push(
        videosFromPipedListItems(
          pipedListItemsFromPayload(json),
          pipedBase,
          channelId,
        ),
      );
    } catch (e) {
      logger.warn("proxy.piped.channel_nextpage_failed", {
        channelId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (out.length >= 12) return out;

  const query = channelName.trim();
  if (query.length >= 2) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildPipedChannelVideosSearchUrl(pipedBase, query),
      );
      push(
        filterVideosForChannel(
          videosFromPipedListItems(pipedRootItems(json), pipedBase, channelId),
          channelId,
        ),
      );
    } catch (e) {
      logger.warn("proxy.piped.channel_search_failed", {
        channelId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (out.length >= 12) return out;

  if (initialPayload && typeof initialPayload === "object") {
    const tabs = (initialPayload as Record<string, unknown>).tabs;
    if (Array.isArray(tabs)) {
      for (const tab of tabs) {
        if (out.length >= 60) break;
        if (!tab || typeof tab !== "object") continue;
        const t = tab as Record<string, unknown>;
        const tabName = typeof t.name === "string" ? t.name.toLowerCase() : "";
        if (tabName === "shorts" || tabName === "playlists") continue;
        const data = typeof t.data === "string" ? t.data : null;
        if (!data) continue;
        try {
          acquireUpstreamSlot();
          const json = await fetchJson(
            buildPipedChannelTabsUrl(pipedBase, data),
          );
          push(
            videosFromPipedListItems(
              pipedListItemsFromPayload(json),
              pipedBase,
              channelId,
              { excludeShorts: true },
            ),
          );
        } catch (e) {
          logger.warn("proxy.piped.channel_tab_failed", {
            channelId,
            tab: tabName,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }
  return out;
}

async function tryInvidiousChannelVideoFallbacks(
  invidiousBase: string,
  channelId: string,
  channelName: string,
): Promise<UnifiedVideo[]> {
  const seen = new Set<string>();
  const out: UnifiedVideo[] = [];
  const push = (list: UnifiedVideo[]) => {
    for (const v of list) {
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      out.push(v);
      if (out.length >= 60) return;
    }
  };

  try {
    acquireUpstreamSlot();
    const { ok, text } = await upstreamGetText(
      buildInvidiousChannelRssUrl(invidiousBase, channelId),
      FETCH_TIMEOUT_MS,
    );
    if (ok && text.trim()) {
      push(
        parseInvidiousChannelRssFeed(
          text,
          channelId,
          invidiousBase,
          channelName,
        ),
      );
    }
  } catch (e) {
    logger.warn("proxy.invidious.channel_rss_failed", {
      channelId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
  if (out.length >= 12) return out;

  const query = channelName.trim();
  if (query.length >= 2) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildInvidiousChannelVideosSearchUrl(invidiousBase, query),
      );
      if (Array.isArray(json)) {
        for (const item of json) {
          const v = mapInvidiousItem(item, invidiousBase);
          if (!v) continue;
          if (v.channelId && v.channelId !== channelId) continue;
          push([v]);
          if (out.length >= 60) break;
        }
      }
    } catch (e) {
      logger.warn("proxy.invidious.channel_search_failed", {
        channelId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

function pipedChannelNextContinuation(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const n = (data as Record<string, unknown>).nextpage;
  if (typeof n === "string" && n.length > 0) return n;
  return null;
}

/** Piped `/channel/{id}` payloads vary by instance; avatar may be missing on the root but present on items. */
function pickPipedChannelAvatarUrl(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const stringCandidates = [
    o.avatarUrl,
    o.avatar,
    o.uploaderAvatar,
    o.thumbnailUrl,
  ];
  for (const raw of stringCandidates) {
    if (typeof raw !== "string") continue;
    const u = resolveInvidiousAbsoluteMediaUrl(raw, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  for (const key of ["avatars", "authorThumbnails", "thumbnails"] as const) {
    const u = resolveInvidiousThumbnail(o[key], pipedBase);
    if (u?.startsWith("http")) return u;
  }
  const streams = Array.isArray(o.relatedStreams) ? o.relatedStreams : [];
  for (const item of streams) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const ua = s.uploaderAvatar;
    if (typeof ua === "string") {
      const u = resolveInvidiousAbsoluteMediaUrl(ua, pipedBase);
      if (u?.startsWith("http")) return u;
    }
  }
  return undefined;
}

function pickPipedChannelBannerUrl(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const stringCandidates = [o.bannerUrl, o.banner, o.authorBanner];
  for (const raw of stringCandidates) {
    if (typeof raw !== "string") continue;
    const u = resolveInvidiousAbsoluteMediaUrl(raw, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  const u = resolveInvidiousThumbnail(o.banners ?? o.authorBanners, pipedBase);
  if (u?.startsWith("http")) return u;
  return undefined;
}

function parsePipedChannelPage(
  data: unknown,
  channelId: string,
  pipedBase: string,
): ChannelPageResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name : "";
  const id = typeof o.id === "string" && o.id.length > 0 ? o.id : channelId;
  const description =
    typeof o.description === "string" ? o.description : undefined;
  const avatarUrl = pickPipedChannelAvatarUrl(o, pipedBase);
  const bannerUrl = pickPipedChannelBannerUrl(o, pipedBase);
  const subscriberCount =
    typeof o.subscriberCount === "number" && Number.isFinite(o.subscriberCount)
      ? Math.round(o.subscriberCount)
      : undefined;
  const streams = Array.isArray(o.relatedStreams) ? o.relatedStreams : [];
  const videos: UnifiedVideo[] = [];
  for (const item of streams) {
    if (pipedItemIsShort(item)) continue;
    const m = mapPipedItem(item, pipedBase);
    if (m && !unifiedVideoIsLikelyShort(m)) videos.push(m);
  }
  if (!name && videos.length === 0) return null;
  const continuation = pipedChannelNextContinuation(data);
  return channelPageResultSchema.parse({
    channelId: id,
    name: name || "Channel",
    description,
    avatarUrl,
    bannerUrl,
    subscriberCount,
    videos,
    continuation,
    sourceUsed: "piped",
  });
}

function parsePipedChannelContinuation(
  data: unknown,
  channelId: string,
  pipedBase: string,
  opts?: { shortsOnly?: boolean },
): ChannelPageResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const streams = Array.isArray(o.relatedStreams) ? o.relatedStreams : [];
  const videos: UnifiedVideo[] = [];
  for (const item of streams) {
    const isShort = pipedItemIsShort(item);
    if (opts?.shortsOnly) {
      if (!isShort) continue;
    } else if (isShort) {
      continue;
    }
    const m = mapPipedItem(item, pipedBase);
    if (!m) continue;
    if (opts?.shortsOnly && !unifiedVideoIsLikelyShort(m)) continue;
    if (!opts?.shortsOnly && unifiedVideoIsLikelyShort(m)) continue;
    videos.push(m);
  }
  const continuation = pipedChannelNextContinuation(data);
  return channelPageResultSchema.parse({
    channelId,
    videos,
    continuation,
    sourceUsed: "piped",
  });
}

function parseInvidiousChannelCombined(
  meta: unknown,
  videosPayload: unknown,
  channelId: string,
  invidiousBase: string,
): ChannelPageResult | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const name =
    typeof m.author === "string"
      ? m.author
      : typeof m.title === "string"
        ? m.title
        : "";
  const description =
    typeof m.description === "string" ? m.description : undefined;
  const avatarUrl = resolveInvidiousThumbnail(
    m.authorThumbnails,
    invidiousBase,
  );
  const bannerUrl = resolveInvidiousThumbnail(m.authorBanners, invidiousBase);
  let subscriberCount: number | undefined;
  if (typeof m.subCount === "number" && Number.isFinite(m.subCount)) {
    subscriberCount = Math.round(m.subCount);
  }
  const videos: UnifiedVideo[] = [];
  let continuation: string | null = null;
  if (videosPayload && typeof videosPayload === "object") {
    const vp = videosPayload as Record<string, unknown>;
    const arr = Array.isArray(vp.videos) ? vp.videos : [];
    for (const item of arr) {
      if (invidiousItemIsShort(item)) continue;
      const v = mapInvidiousItem(item, invidiousBase);
      if (v && !unifiedVideoIsLikelyShort(v)) videos.push(v);
    }
    const c = vp.continuation;
    if (typeof c === "string" && c.length > 0) continuation = c;
  }
  const id =
    typeof m.authorId === "string" && m.authorId.length > 0
      ? m.authorId
      : channelId;
  if (!name && videos.length === 0) return null;
  return channelPageResultSchema.parse({
    channelId: id,
    name: name || "Channel",
    description,
    avatarUrl,
    bannerUrl,
    subscriberCount,
    videos,
    continuation,
    sourceUsed: "invidious",
  });
}

function parseInvidiousChannelVideosContinuation(
  videosPayload: unknown,
  channelId: string,
  invidiousBase: string,
  opts?: { shortsOnly?: boolean },
): ChannelPageResult | null {
  if (!videosPayload || typeof videosPayload !== "object") return null;
  const vp = videosPayload as Record<string, unknown>;
  const arr = Array.isArray(vp.videos) ? vp.videos : [];
  const videos: UnifiedVideo[] = [];
  for (const item of arr) {
    const isShort = invidiousItemIsShort(item);
    if (opts?.shortsOnly) {
      if (!isShort) continue;
    } else if (isShort) {
      continue;
    }
    const v = mapInvidiousItem(item, invidiousBase);
    if (!v) continue;
    if (opts?.shortsOnly && !unifiedVideoIsLikelyShort(v)) continue;
    if (!opts?.shortsOnly && unifiedVideoIsLikelyShort(v)) continue;
    videos.push(v);
  }
  let continuation: string | null = null;
  const c = vp.continuation;
  if (typeof c === "string" && c.length > 0) continuation = c;
  if (videos.length === 0) return null;
  return channelPageResultSchema.parse({
    channelId,
    videos,
    continuation,
    sourceUsed: "invidious",
  });
}

async function fetchPipedChannelShortsPage(
  pipedBase: string,
  channelId: string,
  continuation?: string,
): Promise<ChannelPageResult | null> {
  if (continuation) {
    const json = await fetchJson(
      buildPipedChannelNextUrl(pipedBase, channelId, continuation),
      { source: "piped", baseUrl: pipedBase },
    );
    return parsePipedChannelContinuation(json, channelId, pipedBase, {
      shortsOnly: true,
    });
  }

  const json = await fetchJson(buildPipedChannelUrl(pipedBase, channelId), {
    source: "piped",
    baseUrl: pipedBase,
  });
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const name = typeof root.name === "string" ? root.name : undefined;
  const id =
    typeof root.id === "string" && root.id.length > 0 ? root.id : channelId;

  const tabs = Array.isArray(root.tabs) ? root.tabs : [];
  for (const tab of tabs) {
    if (!tab || typeof tab !== "object") continue;
    const t = tab as Record<string, unknown>;
    const tabName = typeof t.name === "string" ? t.name.toLowerCase() : "";
    if (tabName !== "shorts") continue;
    const data = typeof t.data === "string" ? t.data : null;
    if (!data) continue;
    const tabJson = await fetchJson(buildPipedChannelTabsUrl(pipedBase, data), {
      source: "piped",
      baseUrl: pipedBase,
    });
    const videos = videosFromPipedListItems(
      pipedListItemsFromPayload(tabJson),
      pipedBase,
      channelId,
      { shortsOnly: true },
    );
    return channelPageResultSchema.parse({
      channelId: id,
      name,
      videos,
      continuation: pipedChannelNextContinuation(tabJson),
      sourceUsed: "piped",
    });
  }

  const fallback = videosFromPipedListItems(
    pipedListItemsFromPayload(json),
    pipedBase,
    channelId,
    { shortsOnly: true },
  );
  if (fallback.length === 0) return null;
  return channelPageResultSchema.parse({
    channelId: id,
    name,
    videos: fallback,
    continuation: pipedChannelNextContinuation(json),
    sourceUsed: "piped",
  });
}

async function fetchInvidiousChannelShortsPage(
  invidiousBase: string,
  channelId: string,
  continuation?: string,
): Promise<ChannelPageResult | null> {
  if (continuation) {
    const json = await fetchJson(
      buildInvidiousChannelShortsUrl(invidiousBase, channelId, continuation),
      { source: "invidious", baseUrl: invidiousBase },
    );
    return parseInvidiousChannelVideosContinuation(
      json,
      channelId,
      invidiousBase,
      { shortsOnly: true },
    );
  }

  const [metaJson, shortsJson] = await Promise.all([
    fetchJson(buildInvidiousChannelMetaUrl(invidiousBase, channelId), {
      source: "invidious",
      baseUrl: invidiousBase,
    }),
    fetchJson(buildInvidiousChannelShortsUrl(invidiousBase, channelId), {
      source: "invidious",
      baseUrl: invidiousBase,
    }),
  ]);
  if (!metaJson || typeof metaJson !== "object") return null;
  const m = metaJson as Record<string, unknown>;
  const name =
    typeof m.author === "string"
      ? m.author
      : typeof m.title === "string"
        ? m.title
        : undefined;
  const description =
    typeof m.description === "string" ? m.description : undefined;
  const avatarUrl = resolveInvidiousThumbnail(
    m.authorThumbnails,
    invidiousBase,
  );
  const bannerUrl = resolveInvidiousThumbnail(m.authorBanners, invidiousBase);
  let subscriberCount: number | undefined;
  if (typeof m.subCount === "number" && Number.isFinite(m.subCount)) {
    subscriberCount = Math.round(m.subCount);
  }
  const id =
    typeof m.authorId === "string" && m.authorId.length > 0
      ? m.authorId
      : channelId;

  const page = parseInvidiousChannelVideosContinuation(
    shortsJson,
    channelId,
    invidiousBase,
    { shortsOnly: true },
  );
  if (!page) return null;
  return channelPageResultSchema.parse({
    ...page,
    channelId: id,
    name,
    description,
    avatarUrl,
    bannerUrl,
    subscriberCount,
  });
}

const UCID_RE = /^UC[0-9A-Za-z_-]{22}$/;
/** Process-lifetime cache of channel handle / custom name -> resolved UC id. */
const resolvedChannelUcids = new Map<string, string>();

/**
 * Resolve a YouTube channel handle (`@name`) or legacy custom/user name to a
 * canonical `UC…` id via Invidious `/api/v1/resolveurl` (the direct
 * `/api/v1/channels/@name` endpoint 500s). A bare UCID passes through untouched.
 * On failure the original token is returned, so the caller renders the same
 * not-found state as before instead of throwing.
 */
/**
 * Decode a channel token that may arrive percent-encoded from the URL path
 * (e.g. a handle as "%40name", or double-encoded). Next.js does not reliably
 * decode the dynamic `[channelId]` segment, so "@" reaches us as "%40" and the
 * handle never resolves. Decode defensively (bounded loop for double-encoding),
 * falling back to the raw value if a decode step is malformed.
 */
export function normalizeChannelToken(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 3 && /%[0-9a-fA-F]{2}/.test(s); i++) {
    try {
      const decoded = decodeURIComponent(s);
      if (decoded === s) break;
      s = decoded;
    } catch {
      break;
    }
  }
  return s;
}

/** Persistent handle/custom → UC id cache (survives restarts). */
function readChannelAlias(db: AppDb, alias: string): string | null {
  try {
    const row = db
      .select({ channelId: channelIdAliases.channelId })
      .from(channelIdAliases)
      .where(eq(channelIdAliases.alias, alias))
      .limit(1)
      .all()[0];
    return row?.channelId && UCID_RE.test(row.channelId) ? row.channelId : null;
  } catch {
    return null; // table missing (pre-migration) or read error
  }
}

function writeChannelAlias(db: AppDb, alias: string, channelId: string): void {
  const now = Math.floor(Date.now() / 1000);
  try {
    db.insert(channelIdAliases)
      .values({ alias, channelId, updatedAt: now })
      .onConflictDoUpdate({
        target: channelIdAliases.alias,
        set: { channelId, updatedAt: now },
      })
      .run();
  } catch {
    /* table missing (pre-migration) — in-memory cache still applies */
  }
}

async function resolveChannelUcid(
  db: AppDb,
  channelId: string,
  overrides?: ProxySourceOverrides,
): Promise<string> {
  if (UCID_RE.test(channelId)) return channelId;
  const cached = resolvedChannelUcids.get(channelId);
  if (cached) return cached;
  // Persistent cache: avoids re-hitting the flaky live resolveurl after a
  // restart (the in-memory Map alone went cold on every deploy).
  const persisted = readChannelAlias(db, channelId);
  if (persisted) {
    resolvedChannelUcids.set(channelId, persisted);
    return persisted;
  }
  const bare = channelId.startsWith("@") ? channelId.slice(1) : channelId;
  // A leading `@` is unambiguously a handle; a bare token could be a handle, a
  // /c/ custom URL, or a legacy /user/ name — try each form.
  const ytUrls = channelId.startsWith("@")
    ? [`https://www.youtube.com/@${bare}`]
    : [
        `https://www.youtube.com/@${bare}`,
        `https://www.youtube.com/c/${bare}`,
        `https://www.youtube.com/user/${bare}`,
        `https://www.youtube.com/${bare}`,
      ];
  const { invidiousBases } = resolveProxyBaseCandidates(overrides);
  for (const base of invidiousBases) {
    for (const ytUrl of ytUrls) {
      try {
        const u = new URL("/api/v1/resolveurl", `${normalizeBaseUrl(base)}/`);
        u.searchParams.set("url", ytUrl);
        acquireUpstreamSlot();
        const json = (await fetchJson(u.toString())) as {
          ucid?: string;
          pageType?: string;
        };
        if (json?.ucid && UCID_RE.test(json.ucid)) {
          resolvedChannelUcids.set(channelId, json.ucid);
          writeChannelAlias(db, channelId, json.ucid);
          return json.ucid;
        }
      } catch {
        /* try the next candidate / base */
      }
    }
  }
  // Low-noise telemetry: a handle/custom token we could not map to a UC id.
  // Frequent hits here signal a resolution regression (e.g. a malformed token
  // reaching this point, or the resolveurl upstream failing).
  logger.warn("channel.resolve_unresolved", { channelId });
  return channelId;
}

export async function fetchChannelPage(
  db: AppDb,
  rawInput: ChannelPageInput,
  overrides?: ProxySourceOverrides,
  opts?: FetchChannelPageOptions,
): Promise<ChannelPageResult> {
  // Single normalization boundary: a channel token can reach us percent-encoded
  // (Next does not always decode the dynamic route segment, so a handle arrives
  // as "%40name" instead of "@name"). Decode it here so the whole pipeline —
  // resolution, cache key, and upstream fetch — always sees a clean token.
  const decodedInput: ChannelPageInput = {
    ...rawInput,
    channelId: normalizeChannelToken(rawInput.channelId),
  };
  // Accept YouTube handle / custom / user tokens (@name, c/x, user/x): resolve
  // to a UC id so the whole pipeline (and the cache key) is keyed canonically.
  const canonicalId = await resolveChannelUcid(
    db,
    decodedInput.channelId,
    overrides,
  );
  const input: ChannelPageInput =
    canonicalId === decodedInput.channelId
      ? decodedInput
      : { ...decodedInput, channelId: canonicalId };
  const key = channelCacheKey(input);
  if (opts?.cacheOnly) {
    const fresh = readFreshChannelCache(db, key);
    if (fresh) return fresh;
    const stale = readStaleChannelCache(db, key);
    if (stale) return stale;
    return {
      channelId: input.channelId,
      videos: [],
      continuation: null,
      sourceUsed: "cache",
      stale: true,
    };
  }
  if (!opts?.bypassChannelCache) {
    const fresh = readFreshChannelCache(db, key);
    if (fresh) return fresh;
  }
  const inFlight = inFlightChannel.get(key);
  if (inFlight) return inFlight;

  const task = (async (): Promise<ChannelPageResult> => {
    const { pipedBases, invidiousBases } =
      resolveProxyBaseCandidates(overrides);
    const errors: string[] = [];
    const tab = input.tab ?? "videos";

    let resolved: ChannelPageResult | null = null;
    let pipedChannelPayload: unknown;
    let usedPipedBase = "";
    let usedInvidiousBase = "";

    if (tab === "shorts") {
      for (const pipedBase of pipedBases) {
        try {
          acquireUpstreamSlot();
          if (!input.continuation) acquireUpstreamSlot();
          resolved = await fetchPipedChannelShortsPage(
            pipedBase,
            input.channelId,
            input.continuation,
          );
          if (resolved) {
            usedPipedBase = pipedBase;
            break;
          }
        } catch (e) {
          recordUpstreamFailure(e, "piped", errors, pipedBase);
        }
      }
      if (!resolved) {
        for (const invidiousBase of invidiousBases) {
          if (invidiousPortCollidesWithNextApp(invidiousBase)) {
            errors.push("invidious:port collision with Next.js");
            continue;
          }
          try {
            if (!input.continuation) {
              acquireUpstreamSlot();
              acquireUpstreamSlot();
            } else {
              acquireUpstreamSlot();
            }
            resolved = await fetchInvidiousChannelShortsPage(
              invidiousBase,
              input.channelId,
              input.continuation,
            );
            if (resolved) {
              usedInvidiousBase = invidiousBase;
              break;
            }
          } catch (e) {
            recordUpstreamFailure(e, "invidious", errors, invidiousBase);
          }
        }
      }
    } else {
      for (const pipedBase of pipedBases) {
        try {
          acquireUpstreamSlot();
          const url = input.continuation
            ? buildPipedChannelNextUrl(
                pipedBase,
                input.channelId,
                input.continuation,
              )
            : buildPipedChannelUrl(pipedBase, input.channelId);
          const json = await fetchJson(url, {
            source: "piped",
            baseUrl: pipedBase,
          });
          if (!input.continuation) pipedChannelPayload = json;
          resolved = input.continuation
            ? parsePipedChannelContinuation(json, input.channelId, pipedBase)
            : parsePipedChannelPage(json, input.channelId, pipedBase);
          if (resolved && resolved.videos.length === 0 && !input.continuation) {
            const channelLabel =
              resolved.name && resolved.name !== "Channel"
                ? resolved.name
                : input.channelId;
            const fallbackVideos = await tryPipedChannelVideoFallbacks(
              pipedBase,
              input.channelId,
              json,
              channelLabel,
            );
            if (fallbackVideos.length > 0) {
              resolved = { ...resolved, videos: fallbackVideos };
            } else {
              resolved = null;
            }
          }
          if (resolved) {
            usedPipedBase = pipedBase;
            break;
          }
        } catch (e) {
          recordUpstreamFailure(e, "piped", errors, pipedBase);
        }
      }
    }

    if (tab !== "shorts" && !resolved) {
      for (const invidiousBase of invidiousBases) {
        if (invidiousPortCollidesWithNextApp(invidiousBase)) {
          errors.push("invidious:port collision with Next.js");
          continue;
        }
        try {
          if (input.continuation) {
            acquireUpstreamSlot();
            const json = await fetchJson(
              buildInvidiousChannelVideosUrl(
                invidiousBase,
                input.channelId,
                input.continuation,
              ),
              { source: "invidious", baseUrl: invidiousBase },
            );
            resolved = parseInvidiousChannelVideosContinuation(
              json,
              input.channelId,
              invidiousBase,
            );
            if (resolved && resolved.videos.length === 0) {
              const fallbackVideos = await tryInvidiousChannelVideoFallbacks(
                invidiousBase,
                input.channelId,
                input.channelId,
              );
              if (fallbackVideos.length > 0) {
                resolved = { ...resolved, videos: fallbackVideos };
              }
            }
          } else {
            acquireUpstreamSlot();
            acquireUpstreamSlot();
            const metaUrl = buildInvidiousChannelMetaUrl(
              invidiousBase,
              input.channelId,
            );
            const videosUrl = buildInvidiousChannelVideosUrl(
              invidiousBase,
              input.channelId,
            );
            const [metaJson, videosJson] = await Promise.all([
              fetchJson(metaUrl, {
                source: "invidious",
                baseUrl: invidiousBase,
              }),
              fetchJson(videosUrl, {
                source: "invidious",
                baseUrl: invidiousBase,
              }),
            ]);
            resolved = parseInvidiousChannelCombined(
              metaJson,
              videosJson,
              input.channelId,
              invidiousBase,
            );
            if (resolved && resolved.videos.length === 0) {
              const channelLabel =
                resolved.name && resolved.name !== "Channel"
                  ? resolved.name
                  : typeof (metaJson as Record<string, unknown>).author ===
                      "string"
                    ? ((metaJson as Record<string, unknown>).author as string)
                    : input.channelId;
              const fallbackVideos = await tryInvidiousChannelVideoFallbacks(
                invidiousBase,
                input.channelId,
                channelLabel,
              );
              if (fallbackVideos.length > 0) {
                resolved = { ...resolved, videos: fallbackVideos };
              }
            }
          }
          if (resolved) {
            usedInvidiousBase = invidiousBase;
            break;
          }
        } catch (e) {
          recordUpstreamFailure(e, "invidious", errors, invidiousBase);
        }
      }
    }

    if (!resolved) {
      const stale = readStaleChannelCache(db, key);
      if (stale) return stale;
      throwIfUpstreamFailed(errors, "channel unavailable");
    }

    if (tab === "videos" && !input.continuation) {
      resolved = {
        ...resolved,
        videos: await enrichChannelVideosWithLiveStreams(
          resolved.videos,
          input.channelId,
          {
            pipedBase: usedPipedBase,
            invidiousBase: usedInvidiousBase,
            sourceUsed: resolved.sourceUsed,
            pipedChannelPayload,
          },
        ),
      };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const sortedVideos = sortVideosNewestFirst(resolved.videos, nowSec);
    resolved = { ...resolved, videos: sortedVideos };

    const store = {
      channelId: resolved.channelId,
      name: resolved.name,
      description: resolved.description,
      avatarUrl: resolved.avatarUrl,
      bannerUrl: resolved.bannerUrl,
      subscriberCount: resolved.subscriberCount,
      videos: sortedVideos,
      continuation: resolved.continuation ?? null,
      sourceUsed: liveUpstreamSource(resolved.sourceUsed),
    };
    writeCache(db, key, store.sourceUsed, store, "channel");
    return resolved;
  })();
  registerInFlight(inFlightChannel, key, task);

  // Serve-stale-and-revalidate: an expired row answers instantly while the
  // task above refreshes the cache in the background. Only a channel with no
  // cached row at all (first visit ever) blocks on the live fetch.
  if (!opts?.bypassChannelCache) {
    const stale = readStaleChannelCache(db, key);
    if (stale) return { ...stale, warning: undefined };
  }
  return task;
}
