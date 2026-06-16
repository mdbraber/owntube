import { stripRestrictedListVideos } from "@/lib/feed-exclude-restricted";
import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import { mergeActiveLiveVideosFirst } from "@/lib/live-video";
import { logger } from "@/lib/logger";
import { pipedRelatedListItems } from "@/lib/piped-related-items";
import { sortVideosNewestFirst } from "@/lib/published-sort-key";
import {
  filterShortsFeedVideos,
  invidiousItemIsDiscoveryShort,
  invidiousItemIsStrictShort,
  isDiscoveryShortVideo,
  isStrictShortVideo,
  pipedItemIsDiscoveryShort,
  pipedItemIsStrictShort,
} from "@/lib/short-video";
import {
  SHORTS_DISCOVERY_FALLBACK_QUERIES,
  shortsSearchQueriesForRegion,
} from "@/lib/shorts-discovery-queries";
import {
  pickLivePlaybackDetail,
  pickRicherPlaybackDetail,
  playbackCatalogMaxHeightPx,
  shouldPreferInvidiousOverPiped,
} from "@/lib/upstream-playback-catalog";
import { preferHighResVideoThumbnailUrl } from "@/lib/video-thumbnail-url";
import type { AppDb } from "@/server/db/client";
import { videoCache } from "@/server/db/schema";
import {
  type ProxySourceOverrides,
  resolveProxyBaseCandidates,
} from "@/server/services/proxy/config";

export {
  describeUpstreamAvailability,
  getInstanceSourceInfo,
  type InstanceSourceInfo,
  type InstanceSourceRow,
  type ProxySourceOverrides,
  resolveEffectiveProxyBases,
  resolveProxyBaseCandidates,
  resolveProxyBases,
  type UpstreamAvailability,
} from "@/server/services/proxy/config";

import {
  channelCacheKey,
  detailCacheKey,
  readFreshCacheRow,
  readLatestCacheRow,
  relatedCacheKey,
  searchCacheKey,
  shortsFeedCacheKey,
  trendingCacheKey,
  writeCache,
} from "@/server/services/proxy/cache";
import {
  recordUpstreamFailure,
  rethrowIfInvidiousUpcoming,
  throwIfUpstreamFailed,
} from "@/server/services/proxy/errors";
import { FETCH_TIMEOUT_MS, fetchJson } from "@/server/services/proxy/http";
import {
  mapInvidiousChannelItem,
  mapInvidiousItem,
  mapInvidiousVideo,
} from "@/server/services/proxy/mappers/invidious";
import {
  mapPipedChannelItem,
  mapPipedItem,
  mapPipedStream,
  pipedListItemsFromPayload,
  pipedNextPage,
  pipedRootItems,
} from "@/server/services/proxy/mappers/piped";
import {
  channelIdFromPath,
  liveUpstreamSource,
  normalizeBaseUrl,
  pickInvidiousStoryboard,
  resolveInvidiousAbsoluteMediaUrl,
  resolveInvidiousThumbnail,
} from "@/server/services/proxy/normalize";
import {
  type ChannelPageInput,
  type ChannelPageResult,
  cachedChannelPayloadSchema,
  cachedSearchPayloadSchema,
  cachedShortsFeedPayloadSchema,
  cachedTrendingPayloadSchema,
  channelPageResultSchema,
  type RelatedVideosResult,
  relatedVideosResultSchema,
  type SearchVideosInput,
  type SearchVideosResult,
  type ShortsFeedInput,
  type ShortsFeedResult,
  searchVideosResultSchema,
  shortsFeedResultSchema,
  type TrendingInput,
  type TrendingVideosResult,
  trendingVideosResultSchema,
  type UnifiedChannel,
  type UnifiedComment,
  type UnifiedVideo,
  unifiedCommentSchema,
  unifiedVideoSchema,
  type VideoCommentsInput,
  type VideoCommentsResult,
  type VideoDetail,
  type VideoDetailInput,
  type VideoStoryboard,
  videoCommentsResultSchema,
  videoDetailSchema,
} from "@/server/services/proxy.types";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";
import { upstreamGetText } from "@/server/services/upstream-get";

const inFlightTrending = new Map<string, Promise<TrendingVideosResult>>();
const inFlightShortsFeed = new Map<string, Promise<ShortsFeedResult>>();
const inFlightChannel = new Map<string, Promise<ChannelPageResult>>();

export function clearProxyCaches(db: AppDb): { clearedRows: number } {
  inFlightTrending.clear();
  inFlightShortsFeed.clear();
  inFlightChannel.clear();
  const res = db.delete(videoCache).run();
  return { clearedRows: Number(res.changes ?? 0) };
}

export { UpstreamAgeRestrictedError } from "@/server/errors/upstream-age-restricted";
export { UpstreamLiveUpcomingError } from "@/server/errors/upstream-live-upcoming";

function resolveShortsDiscoveryQueries(
  input: ShortsFeedInput,
  region: string,
): string[] {
  if (input.discoveryQueries && input.discoveryQueries.length > 0) {
    return [...input.discoveryQueries];
  }
  const regional = shortsSearchQueriesForRegion(region);
  return [
    ...regional,
    ...SHORTS_DISCOVERY_FALLBACK_QUERIES.filter((q) => !regional.includes(q)),
  ];
}

async function tryFetchInvidiousStoryboard(
  videoId: string,
  invidiousBase: string,
): Promise<VideoStoryboard | undefined> {
  try {
    acquireUpstreamSlot();
    const json = await fetchJson(
      buildInvidiousVideosUrl(invidiousBase, videoId),
      { source: "invidious", baseUrl: invidiousBase },
    );
    if (!json || typeof json !== "object") return undefined;
    return pickInvidiousStoryboard(
      json as Record<string, unknown>,
      invidiousBase,
    );
  } catch {
    return undefined;
  }
}

function buildPipedSearchUrl(
  base: string,
  input: SearchVideosInput,
  filter: "all" | "channels" = "all",
): string {
  const u = new URL("/search", `${base}/`);
  u.searchParams.set("q", input.q);
  u.searchParams.set("filter", filter);
  if (input.region) {
    u.searchParams.set("region", input.region.toUpperCase());
  }
  if (input.continuation) {
    u.searchParams.set("nextpage", input.continuation);
  }
  return u.toString();
}

function buildInvidiousSearchUrl(
  base: string,
  input: SearchVideosInput,
  type: "all" | "channel" | "video" = "all",
): string {
  const u = new URL("/api/v1/search", `${base}/`);
  u.searchParams.set("q", input.q);
  u.searchParams.set("type", type);
  if (input.region) {
    u.searchParams.set("region", input.region.toUpperCase());
  }
  const page =
    input.continuation && /^\d+$/.test(input.continuation)
      ? input.continuation
      : "1";
  u.searchParams.set("page", page);
  return u.toString();
}

function readFreshSearchCache(
  db: AppDb,
  key: string,
): SearchVideosResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedSearchPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    channels: parsed.data.channels,
    continuation: parsed.data.continuation,
    sourceUsed: "cache",
    stale: false,
  };
}

function readStaleSearchCache(
  db: AppDb,
  key: string,
): SearchVideosResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedSearchPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    channels: parsed.data.channels,
    continuation: parsed.data.continuation,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

const SEARCH_CHANNEL_LIMIT = 12;

function parsePipedSearch(
  data: unknown,
  limit: number,
  pipedBase: string,
): {
  videos: UnifiedVideo[];
  channels: UnifiedChannel[];
  continuation: string | null;
} {
  const items = pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  const channels: UnifiedChannel[] = [];
  const seenChannelIds = new Set<string>();
  for (const item of items) {
    if (videos.length < limit) {
      const v = mapPipedItem(item, pipedBase);
      if (v) videos.push(v);
    }
    if (channels.length < SEARCH_CHANNEL_LIMIT) {
      const c = mapPipedChannelItem(item, pipedBase);
      if (c && !seenChannelIds.has(c.channelId)) {
        seenChannelIds.add(c.channelId);
        channels.push(c);
      }
    }
  }
  return { videos, channels, continuation: pipedNextPage(data) };
}

function parseInvidiousSearch(
  data: unknown,
  limit: number,
  page: number,
  baseUrl: string,
): {
  videos: UnifiedVideo[];
  channels: UnifiedChannel[];
  continuation: string | null;
} {
  if (!Array.isArray(data))
    return { videos: [], channels: [], continuation: null };
  const videos: UnifiedVideo[] = [];
  const channels: UnifiedChannel[] = [];
  const seenChannelIds = new Set<string>();
  for (const item of data) {
    if (videos.length < limit) {
      const v = mapInvidiousItem(item, baseUrl);
      if (v) videos.push(v);
    }
    if (channels.length < SEARCH_CHANNEL_LIMIT) {
      const c = mapInvidiousChannelItem(item, baseUrl);
      if (c && !seenChannelIds.has(c.channelId)) {
        seenChannelIds.add(c.channelId);
        channels.push(c);
      }
    }
  }
  const continuation = videos.length >= limit ? String(page + 1) : null;
  return { videos, channels, continuation };
}

export async function searchVideos(
  db: AppDb,
  input: SearchVideosInput,
  overrides?: ProxySourceOverrides,
): Promise<SearchVideosResult> {
  const parsedInput = input;
  const limit = parsedInput.limit ?? 20;
  const key = searchCacheKey(parsedInput);

  const cached = readFreshSearchCache(db, key);
  if (cached) return cached;

  const { pipedBases, invidiousBases } = resolveProxyBaseCandidates(overrides);

  const errors: string[] = [];

  const tryPiped = async (): Promise<SearchVideosResult | null> => {
    for (const pipedBase of pipedBases) {
      try {
        acquireUpstreamSlot();
        const url = buildPipedSearchUrl(pipedBase, parsedInput);
        logger.info("proxy.piped.request", {
          url: url.replace(parsedInput.q, "[q]"),
        });
        const json = await fetchJson(url, {
          source: "piped",
          baseUrl: pipedBase,
        });
        let { videos, channels, continuation } = parsePipedSearch(
          json,
          limit,
          pipedBase,
        );
        if (channels.length === 0 && !parsedInput.continuation) {
          try {
            acquireUpstreamSlot();
            const channelUrl = buildPipedSearchUrl(
              pipedBase,
              parsedInput,
              "channels",
            );
            const channelJson = await fetchJson(channelUrl, {
              source: "piped",
              baseUrl: pipedBase,
            });
            const channelOnly = parsePipedSearch(channelJson, limit, pipedBase);
            if (channelOnly.channels.length > 0) {
              channels = channelOnly.channels;
            }
          } catch {
            // optional channel-only pass
          }
        }
        const result: SearchVideosResult = {
          videos,
          channels,
          continuation,
          sourceUsed: "piped",
        };
        const safe = searchVideosResultSchema.parse(result);
        return safe;
      } catch (e) {
        recordUpstreamFailure(e, "piped", errors, pipedBase);
        logger.warn("proxy.piped.failed", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return null;
  };

  const tryInvidious = async (): Promise<SearchVideosResult | null> => {
    for (const invidiousBase of invidiousBases) {
      if (invidiousPortCollidesWithNextApp(invidiousBase)) {
        errors.push(
          "invidious:INVIDIOUS_BASE_URL uses the same loopback port as this Next.js server (PORT). Server fetch would hit OwnTube itself (404 on /api/v1/...). Run Invidious on another port (e.g. 3001 in docker-compose) or start Next on a different port (e.g. pnpm dev -- -p 3000).",
        );
        continue;
      }
      try {
        acquireUpstreamSlot();
        const page =
          parsedInput.continuation && /^\d+$/.test(parsedInput.continuation)
            ? Number.parseInt(parsedInput.continuation, 10)
            : 1;
        const url = buildInvidiousSearchUrl(invidiousBase, {
          ...parsedInput,
          continuation: String(page),
        });
        logger.info("proxy.invidious.request", {
          url: url.replace(parsedInput.q, "[q]"),
        });
        const json = await fetchJson(url, {
          source: "invidious",
          baseUrl: invidiousBase,
        });
        let { videos, channels, continuation } = parseInvidiousSearch(
          json,
          limit,
          page,
          invidiousBase,
        );
        if (channels.length === 0 && page === 1) {
          try {
            acquireUpstreamSlot();
            const channelUrl = buildInvidiousSearchUrl(
              invidiousBase,
              { ...parsedInput, continuation: "1" },
              "channel",
            );
            const channelJson = await fetchJson(channelUrl, {
              source: "invidious",
              baseUrl: invidiousBase,
            });
            const channelOnly = parseInvidiousSearch(
              channelJson,
              limit,
              page,
              invidiousBase,
            );
            if (channelOnly.channels.length > 0) {
              channels = channelOnly.channels;
            }
          } catch {
            // optional channel-only pass
          }
        }
        const result: SearchVideosResult = {
          videos,
          channels,
          continuation,
          sourceUsed: "invidious",
        };
        return searchVideosResultSchema.parse(result);
      } catch (e) {
        recordUpstreamFailure(e, "invidious", errors, invidiousBase);
        logger.warn("proxy.invidious.failed", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return null;
  };

  let resolved = await tryPiped();
  if (
    !resolved ||
    (resolved.videos.length === 0 && (resolved.channels?.length ?? 0) === 0)
  ) {
    const fromInv = await tryInvidious();
    if (fromInv) {
      resolved = fromInv;
    }
  }

  if (
    !resolved ||
    (resolved.videos.length === 0 && (resolved.channels?.length ?? 0) === 0)
  ) {
    const stale = readStaleSearchCache(db, key);
    if (stale) return stale;
    throwIfUpstreamFailed(errors, "no results");
  }
  writeCache(
    db,
    key,
    liveUpstreamSource(resolved.sourceUsed),
    resolved,
    "search",
  );
  return resolved;
}

function inferMediaProxyBase(detail: VideoDetail): string | undefined {
  if (detail.mediaProxyBase) return detail.mediaProxyBase;
  for (const s of detail.videoSources) {
    if (!s.url) continue;
    try {
      const u = new URL(s.url);
      const p = u.pathname.toLowerCase();
      if (p === "/videoplayback" || p.startsWith("/vi/")) {
        return u.origin;
      }
    } catch {
      /* skip */
    }
  }
  return undefined;
}

function enrichDetailForPlayback(detail: VideoDetail): VideoDetail {
  const mediaProxyBase = inferMediaProxyBase(detail);
  if (!mediaProxyBase || mediaProxyBase === detail.mediaProxyBase) {
    return detail;
  }
  return { ...detail, mediaProxyBase };
}

function readFreshDetailCache(db: AppDb, key: string): VideoDetail | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const parsed = videoDetailSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return enrichDetailForPlayback({
    ...parsed.data,
    sourceUsed: "cache",
    stale: false,
  });
}

function readStaleDetailCache(db: AppDb, key: string): VideoDetail | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const parsed = videoDetailSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function readFreshRelatedCache(
  db: AppDb,
  key: string,
): RelatedVideosResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const parsed = relatedVideosResultSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return { ...parsed.data, sourceUsed: "cache", stale: false };
}

function readStaleRelatedCache(
  db: AppDb,
  key: string,
): RelatedVideosResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const parsed = relatedVideosResultSchema.safeParse(
    JSON.parse(row.payloadJson) as unknown,
  );
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    ...parsed.data,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function buildPipedStreamsUrl(base: string, videoId: string): string {
  return new URL(
    `/streams/${encodeURIComponent(videoId)}`,
    `${base}/`,
  ).toString();
}

function buildInvidiousVideosUrl(base: string, videoId: string): string {
  return new URL(
    `/api/v1/videos/${encodeURIComponent(videoId)}`,
    `${base}/`,
  ).toString();
}

function buildPipedRelatedUrl(base: string, videoId: string): string {
  return new URL(
    `/streams/${encodeURIComponent(videoId)}/related`,
    `${base}/`,
  ).toString();
}

function buildInvidiousRelatedUrl(base: string, videoId: string): string {
  return new URL(
    `/api/v1/videos/${encodeURIComponent(videoId)}/related`,
    `${base}/`,
  ).toString();
}

export type FetchVideoDetailOptions = {
  /**
   * When true, skip the SQLite “fresh” row for this video so Invidious/Piped
   * return a new `hlsUrl` and adaptive URLs (signed links go 404 quickly).
   */
  bypassDetailCache?: boolean;
  /** Prefer this upstream for live HLS when both Piped and Invidious are set. */
  preferUpstream?: VideoDetailInput["preferUpstream"];
};

export type FetchChannelPageOptions = {
  /** Force a live upstream read instead of using the fresh channel cache row. */
  bypassChannelCache?: boolean;
};

export async function fetchVideoDetail(
  db: AppDb,
  input: VideoDetailInput,
  overrides?: ProxySourceOverrides,
  opts?: FetchVideoDetailOptions,
): Promise<VideoDetail> {
  const key = detailCacheKey(input);
  if (!opts?.bypassDetailCache) {
    const cached = readFreshDetailCache(db, key);
    if (cached) return cached;
  }

  const { pipedBases, invidiousBases } = resolveProxyBaseCandidates(overrides);
  const errors: string[] = [];

  let resolved: VideoDetail | null = null;
  let pipedResolved: VideoDetail | null = null;
  let invidiousResolved: VideoDetail | null = null;
  const preferUpstream = opts?.preferUpstream ?? input.preferUpstream;

  const fetchInvidiousDetail = async (): Promise<VideoDetail | null> => {
    for (const invidiousBase of invidiousBases) {
      if (invidiousPortCollidesWithNextApp(invidiousBase)) {
        errors.push(
          "invidious:INVIDIOUS_BASE_URL port conflicts with Next.js PORT (server would call itself).",
        );
        continue;
      }
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildInvidiousVideosUrl(invidiousBase, input.videoId),
          { source: "invidious", baseUrl: invidiousBase },
        );
        return mapInvidiousVideo(json, invidiousBase);
      } catch (error) {
        rethrowIfInvidiousUpcoming(error, input.videoId);
        recordUpstreamFailure(error, "invidious", errors, invidiousBase);
      }
    }
    return null;
  };

  for (const pipedBase of pipedBases) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildPipedStreamsUrl(pipedBase, input.videoId),
        { source: "piped", baseUrl: pipedBase },
      );
      pipedResolved = mapPipedStream(json, pipedBase, input.videoId);
      resolved = pipedResolved;
      break;
    } catch (error) {
      recordUpstreamFailure(error, "piped", errors, pipedBase);
    }
  }

  const liveFromPiped = pipedResolved?.isLive === true;
  const shouldConsultInvidiousForLive =
    liveFromPiped || preferUpstream === "invidious";

  if (!resolved && invidiousBases.length > 0) {
    invidiousResolved = await fetchInvidiousDetail();
    resolved = invidiousResolved;
  } else if (shouldConsultInvidiousForLive && invidiousBases.length > 0) {
    invidiousResolved = await fetchInvidiousDetail();
    if (pipedResolved?.isLive || invidiousResolved?.isLive) {
      resolved = pickLivePlaybackDetail(
        pipedResolved,
        invidiousResolved,
        preferUpstream,
      );
    }
  } else if (
    pipedResolved &&
    invidiousBases.length > 0 &&
    shouldPreferInvidiousOverPiped(pipedResolved)
  ) {
    invidiousResolved = await fetchInvidiousDetail();
    if (invidiousResolved) {
      const picked = pickRicherPlaybackDetail(pipedResolved, invidiousResolved);
      if (picked.sourceUsed === "invidious") {
        logger.info("upstream.prefer_invidious_over_piped", {
          videoId: input.videoId,
          pipedMaxHeight: playbackCatalogMaxHeightPx(pipedResolved),
          invidiousMaxHeight: playbackCatalogMaxHeightPx(invidiousResolved),
        });
      }
      resolved = picked;
    }
  }

  if (!resolved) {
    const stale = readStaleDetailCache(db, key);
    if (stale) return stale;
    throwIfUpstreamFailed(errors, "video detail unavailable");
  }

  let enriched = enrichDetailForPlayback(resolved);
  const storyboardInvidiousBase = invidiousBases[0];
  if (storyboardInvidiousBase && !enriched.storyboard) {
    const storyboard = await tryFetchInvidiousStoryboard(
      input.videoId,
      storyboardInvidiousBase,
    );
    if (storyboard) enriched = { ...enriched, storyboard };
  }
  writeCache(
    db,
    key,
    liveUpstreamSource(enriched.sourceUsed),
    enriched,
    "streams",
  );
  return enriched;
}

function parseRelatedFromPiped(
  data: unknown,
  limit: number,
  pipedBase: string,
): UnifiedVideo[] {
  const items = pipedRelatedListItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const mapped = mapPipedItem(item, pipedBase);
    if (mapped) videos.push(mapped);
    if (videos.length >= limit) break;
  }
  return videos;
}

function parseRelatedFromInvidious(
  data: unknown,
  limit: number,
  baseUrl: string,
): UnifiedVideo[] {
  if (!Array.isArray(data)) return [];
  const videos: UnifiedVideo[] = [];
  for (const item of data) {
    const mapped = mapInvidiousItem(item, baseUrl);
    if (mapped) videos.push(mapped);
    if (videos.length >= limit) break;
  }
  return videos;
}

async function relatedVideosFromSameUploader(
  db: AppDb,
  input: VideoDetailInput,
  limit: number,
  overrides?: ProxySourceOverrides,
): Promise<UnifiedVideo[] | null> {
  try {
    const detail = await fetchVideoDetail(db, input, overrides);
    const channelId = detail.channelId;
    if (!channelId) return null;
    const page = await fetchChannelPage(db, { channelId }, overrides);
    const list = page.videos.filter((v) => v.videoId !== input.videoId);
    if (list.length === 0) return null;
    return list.slice(0, limit);
  } catch {
    return null;
  }
}

function tokenizeRelatedText(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((part) => part.length >= 3);
}

function scoreRelatedCandidate(
  seed: VideoDetail,
  candidate: UnifiedVideo,
): number {
  const seedTokens = new Set(tokenizeRelatedText(seed.title));
  const candidateTokens = new Set(tokenizeRelatedText(candidate.title));
  let overlap = 0;
  for (const t of candidateTokens) {
    if (seedTokens.has(t)) overlap += 1;
  }
  const candidateTokenCount = candidateTokens.size || 1;
  const overlapRatio = overlap / candidateTokenCount;
  const sameChannel =
    Boolean(seed.channelId) && Boolean(candidate.channelId)
      ? seed.channelId === candidate.channelId
      : false;
  const viewScore = Math.log10(
    Math.max(1, Math.floor(candidate.viewCount ?? 0)),
  );
  return (
    overlapRatio * 100 +
    overlap * 8 +
    (sameChannel ? -6 : 6) +
    Math.min(6, viewScore)
  );
}

function mergeAndRankRelatedVideos(
  seed: VideoDetail,
  inputVideoId: string,
  limit: number,
  preferred: UnifiedVideo[],
  extras: UnifiedVideo[],
): UnifiedVideo[] {
  const unique = new Map<string, UnifiedVideo>();
  for (const item of [...preferred, ...extras]) {
    if (item.videoId === inputVideoId) continue;
    if (unique.has(item.videoId)) continue;
    unique.set(item.videoId, item);
  }
  const ranked = [...unique.values()];
  ranked.sort(
    (a, b) => scoreRelatedCandidate(seed, b) - scoreRelatedCandidate(seed, a),
  );
  return ranked.slice(0, limit);
}

export async function fetchRelatedVideos(
  db: AppDb,
  input: VideoDetailInput,
  limit = 20,
  overrides?: ProxySourceOverrides,
): Promise<RelatedVideosResult> {
  const key = relatedCacheKey(input);
  const cached = readFreshRelatedCache(db, key);
  if (cached) return cached;

  const { pipedBases, invidiousBases } = resolveProxyBaseCandidates(overrides);
  const errors: string[] = [];

  let resolved: RelatedVideosResult | null = null;
  for (const pipedBase of pipedBases) {
    try {
      acquireUpstreamSlot();
      const json = await fetchJson(
        buildPipedStreamsUrl(pipedBase, input.videoId),
        { source: "piped", baseUrl: pipedBase },
      );
      const fromStreams = parseRelatedFromPiped(json, limit, pipedBase);
      if (fromStreams.length > 0) {
        resolved = relatedVideosResultSchema.parse({
          videos: fromStreams,
          sourceUsed: "piped",
        });
      }
    } catch (error) {
      recordUpstreamFailure(error, "piped", errors, pipedBase);
    }
    if (!resolved || resolved.videos.length === 0) {
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildPipedRelatedUrl(pipedBase, input.videoId),
          { emptyBodyAs: [], source: "piped", baseUrl: pipedBase },
        );
        const fromRelatedRoute = parseRelatedFromPiped(json, limit, pipedBase);
        if (fromRelatedRoute.length > 0) {
          resolved = relatedVideosResultSchema.parse({
            videos: fromRelatedRoute,
            sourceUsed: "piped",
          });
        }
      } catch (error) {
        recordUpstreamFailure(error, "piped", errors, pipedBase);
      }
    }
    if (resolved && resolved.videos.length > 0) break;
  }

  if (
    (!resolved || resolved.videos.length === 0) &&
    invidiousBases.length > 0
  ) {
    for (const invidiousBase of invidiousBases) {
      if (invidiousPortCollidesWithNextApp(invidiousBase)) {
        errors.push(
          "invidious:INVIDIOUS_BASE_URL port conflicts with Next.js PORT (server would call itself).",
        );
        continue;
      }
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildInvidiousRelatedUrl(invidiousBase, input.videoId),
          { emptyBodyAs: [], source: "invidious", baseUrl: invidiousBase },
        );
        resolved = relatedVideosResultSchema.parse({
          videos: parseRelatedFromInvidious(json, limit, invidiousBase),
          sourceUsed: "invidious",
        });
        if (resolved.videos.length > 0) break;
      } catch (error) {
        recordUpstreamFailure(error, "invidious", errors, invidiousBase);
      }
    }
  }

  if (!resolved) {
    const stale = readStaleRelatedCache(db, key);
    if (stale) return stale;
    throwIfUpstreamFailed(errors, "related videos unavailable");
  }

  let warning = resolved.warning;
  const seed = await fetchVideoDetail(db, input, overrides).catch(() => null);
  if (seed) {
    const current = resolved.videos.filter((v) => v.videoId !== input.videoId);
    const crossChannelCount = current.filter(
      (v) => v.channelId && seed.channelId && v.channelId !== seed.channelId,
    ).length;
    const needsBroaderPool =
      current.length < limit || (current.length > 0 && crossChannelCount === 0);
    let extraPool: UnifiedVideo[] = [];
    if (needsBroaderPool) {
      const fromSearch = await searchVideos(
        db,
        { q: seed.title, limit: Math.min(50, Math.max(limit * 3, 24)) },
        overrides,
      ).catch(() => null);
      if (fromSearch?.videos?.length) {
        extraPool = fromSearch.videos;
        warning =
          warning ??
          "Related feed lacked diversity; mixed in title-matched videos from search.";
      }
    }
    const ranked = mergeAndRankRelatedVideos(
      seed,
      input.videoId,
      limit,
      current,
      extraPool,
    );
    if (ranked.length > 0) {
      resolved = {
        ...resolved,
        videos: ranked,
        warning,
      };
    }
  }

  if (resolved.videos.length === 0) {
    const fallback = await relatedVideosFromSameUploader(
      db,
      input,
      limit,
      overrides,
    );
    if (fallback && fallback.length > 0) {
      resolved = {
        videos: fallback,
        sourceUsed: resolved.sourceUsed,
        warning:
          "No related list available; showing recent uploads from the same channel.",
      };
    }
  }

  if (resolved.videos.length > 0) {
    writeCache(
      db,
      key,
      liveUpstreamSource(resolved.sourceUsed),
      resolved,
      "related",
    );
  }
  return resolved;
}

/* -------------------------------------------------------------------------- */
/* Comments                                                                   */
/* -------------------------------------------------------------------------- */

function buildPipedCommentsUrl(base: string, videoId: string): string {
  return new URL(
    `/comments/${encodeURIComponent(videoId)}`,
    `${normalizeBaseUrl(base)}/`,
  ).toString();
}

function buildPipedCommentsNextUrl(
  base: string,
  videoId: string,
  nextpage: string,
): string {
  const u = new URL(
    `/nextpage/comments/${encodeURIComponent(videoId)}`,
    `${normalizeBaseUrl(base)}/`,
  );
  u.searchParams.set("nextpage", nextpage);
  return u.toString();
}

function buildInvidiousCommentsUrl(
  base: string,
  videoId: string,
  sortBy: "top" | "new",
  continuation?: string,
): string {
  const u = new URL(
    `/api/v1/comments/${encodeURIComponent(videoId)}`,
    `${normalizeBaseUrl(base)}/`,
  );
  u.searchParams.set("sort_by", sortBy);
  u.searchParams.set("source", "youtube");
  if (continuation) u.searchParams.set("continuation", continuation);
  return u.toString();
}

function mapPipedComment(
  raw: unknown,
  pipedBase: string,
): UnifiedComment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const commentId = typeof o.commentId === "string" ? o.commentId.trim() : "";
  const author = typeof o.author === "string" ? o.author.trim() : "";
  const text = typeof o.commentText === "string" ? o.commentText.trim() : "";
  if (!commentId || !author || !text) return null;
  const commentorUrl =
    typeof o.commentorUrl === "string" ? o.commentorUrl : undefined;
  const thumb = typeof o.thumbnail === "string" ? o.thumbnail : undefined;
  const likeCount =
    typeof o.likeCount === "number" && Number.isFinite(o.likeCount)
      ? Math.max(0, Math.floor(o.likeCount))
      : undefined;
  const parsed = unifiedCommentSchema.safeParse({
    commentId,
    author,
    authorId: channelIdFromPath(commentorUrl),
    text,
    publishedText:
      typeof o.commentedTime === "string" ? o.commentedTime : undefined,
    authorAvatarUrl: resolveInvidiousAbsoluteMediaUrl(thumb, pipedBase),
    likeCount,
    isPinned: o.pinned === true,
    isHearted: o.hearted === true,
    isVerified: o.verified === true,
  });
  if (!parsed.success) return null;
  return parsed.data;
}

function mapPipedComments(
  data: unknown,
  pipedBase: string,
  videoId: string,
): VideoCommentsResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const comments: UnifiedComment[] = [];
  if (Array.isArray(o.comments)) {
    for (const raw of o.comments) {
      const mapped = mapPipedComment(raw, pipedBase);
      if (mapped) comments.push(mapped);
    }
  }
  const nextpage =
    typeof o.nextpage === "string" && o.nextpage.trim().length > 0
      ? o.nextpage.trim()
      : null;
  const parsed = videoCommentsResultSchema.safeParse({
    videoId,
    comments,
    disabled: o.disabled === true,
    continuation: nextpage,
    sourceUsed: "piped",
  });
  if (!parsed.success) return null;
  return parsed.data;
}

function mapInvidiousComment(
  raw: unknown,
  invidiousBase: string,
): UnifiedComment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const commentId = typeof o.commentId === "string" ? o.commentId.trim() : "";
  const author = typeof o.author === "string" ? o.author.trim() : "";
  const contentHtml =
    typeof o.contentHtml === "string" ? o.contentHtml.trim() : "";
  const content = typeof o.content === "string" ? o.content.trim() : "";
  const text = contentHtml || content;
  if (!commentId || !author || !text) return null;
  const authorId =
    typeof o.authorId === "string" && o.authorId.trim().length > 0
      ? o.authorId.trim()
      : channelIdFromPath(
          typeof o.authorUrl === "string" ? o.authorUrl : undefined,
        );
  const likeCount =
    typeof o.likeCount === "number" && Number.isFinite(o.likeCount)
      ? Math.max(0, Math.floor(o.likeCount))
      : undefined;
  const replies =
    o.replies && typeof o.replies === "object"
      ? (o.replies as Record<string, unknown>)
      : undefined;
  const replyCount =
    replies &&
    typeof replies.replyCount === "number" &&
    Number.isFinite(replies.replyCount)
      ? Math.max(0, Math.floor(replies.replyCount))
      : undefined;
  const parsed = unifiedCommentSchema.safeParse({
    commentId,
    author,
    authorId,
    text,
    publishedText:
      typeof o.publishedText === "string" ? o.publishedText : undefined,
    authorAvatarUrl: resolveInvidiousThumbnail(
      o.authorThumbnails,
      invidiousBase,
    ),
    likeCount,
    isPinned: o.isPinned === true,
    isHearted: Boolean(o.creatorHeart),
    replyCount,
  });
  if (!parsed.success) return null;
  return parsed.data;
}

function mapInvidiousComments(
  data: unknown,
  invidiousBase: string,
  videoId: string,
): VideoCommentsResult | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const comments: UnifiedComment[] = [];
  if (Array.isArray(o.comments)) {
    for (const raw of o.comments) {
      const mapped = mapInvidiousComment(raw, invidiousBase);
      if (mapped) comments.push(mapped);
    }
  }
  const continuation =
    typeof o.continuation === "string" && o.continuation.trim().length > 0
      ? o.continuation.trim()
      : null;
  const commentCount =
    typeof o.commentCount === "number" && Number.isFinite(o.commentCount)
      ? Math.max(0, Math.floor(o.commentCount))
      : undefined;
  const parsed = videoCommentsResultSchema.safeParse({
    videoId:
      typeof o.videoId === "string" && o.videoId.trim().length > 0
        ? o.videoId.trim()
        : videoId,
    comments,
    continuation,
    commentCount,
    sourceUsed: "invidious",
  });
  if (!parsed.success) return null;
  return parsed.data;
}

export async function fetchVideoComments(
  _db: AppDb,
  input: VideoCommentsInput,
  overrides?: ProxySourceOverrides,
): Promise<VideoCommentsResult> {
  const { pipedBases, invidiousBases } = resolveProxyBaseCandidates(overrides);
  const errors: string[] = [];
  const continuation = input.continuation?.trim() || undefined;

  let resolved: VideoCommentsResult | null = null;
  if (input.sortBy === "top") {
    for (const pipedBase of pipedBases) {
      try {
        acquireUpstreamSlot();
        const url = continuation
          ? buildPipedCommentsNextUrl(pipedBase, input.videoId, continuation)
          : buildPipedCommentsUrl(pipedBase, input.videoId);
        const json = await fetchJson(url, {
          source: "piped",
          baseUrl: pipedBase,
        });
        resolved = mapPipedComments(json, pipedBase, input.videoId);
        break;
      } catch (error) {
        recordUpstreamFailure(error, "piped", errors, pipedBase);
      }
    }
  }
  if (!resolved) {
    for (const invidiousBase of invidiousBases) {
      if (invidiousPortCollidesWithNextApp(invidiousBase)) {
        errors.push(
          "invidious:INVIDIOUS_BASE_URL port conflicts with Next.js PORT (server would call itself).",
        );
        continue;
      }
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildInvidiousCommentsUrl(
            invidiousBase,
            input.videoId,
            input.sortBy,
            continuation,
          ),
          { source: "invidious", baseUrl: invidiousBase },
        );
        resolved = mapInvidiousComments(json, invidiousBase, input.videoId);
        break;
      } catch (error) {
        recordUpstreamFailure(error, "invidious", errors, invidiousBase);
      }
    }
  }

  if (!resolved) {
    throwIfUpstreamFailed(errors, "comments unavailable");
  }
  return resolved;
}

/* -------------------------------------------------------------------------- */
/* Trending                                                                   */
/* -------------------------------------------------------------------------- */

function readFreshTrendingCache(
  db: AppDb,
  key: string,
): TrendingVideosResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedTrendingPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    videos: stripRestrictedListVideos(parsed.data.videos),
    sourceUsed: "cache",
    stale: false,
  };
}

function readFreshShortsFeedCache(
  db: AppDb,
  key: string,
): ShortsFeedResult | null {
  const row = readFreshCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedShortsFeedPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.info("video_cache.hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    continuation: parsed.data.continuation,
    sourceUsed: "cache",
    stale: false,
  };
}

function readStaleShortsFeedCache(
  db: AppDb,
  key: string,
): ShortsFeedResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedShortsFeedPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    videos: parsed.data.videos,
    continuation: parsed.data.continuation,
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function readStaleTrendingCache(
  db: AppDb,
  key: string,
): TrendingVideosResult | null {
  const row = readLatestCacheRow(db, key);
  if (!row) return null;
  const raw = JSON.parse(row.payloadJson) as unknown;
  const parsed = cachedTrendingPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  logger.warn("video_cache.stale_hit", { cacheKey: key, kind: row.kind });
  return {
    videos: stripRestrictedListVideos(parsed.data.videos),
    sourceUsed: "cache",
    stale: true,
    warning: "Upstream unavailable, serving stale cache.",
  };
}

function buildPipedTrendingUrl(
  base: string,
  region: string,
  category?: string,
): string {
  const u = new URL("/trending", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("region", region.toUpperCase());
  if (category) u.searchParams.set("type", category);
  return u.toString();
}

function buildInvidiousTrendingUrl(
  base: string,
  region: string,
  category?: string,
): string {
  const u = new URL("/api/v1/trending", `${normalizeBaseUrl(base)}/`);
  u.searchParams.set("region", region.toUpperCase());
  if (category) u.searchParams.set("type", category);
  return u.toString();
}

function parsePipedTrending(
  data: unknown,
  limit: number,
  pipedBase: string,
): UnifiedVideo[] {
  const items = Array.isArray(data) ? data : pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const m = mapPipedItem(item, pipedBase);
    if (m) videos.push(m);
    if (videos.length >= limit) break;
  }
  return videos;
}

function parseInvidiousTrending(
  data: unknown,
  limit: number,
  invidiousBase: string,
): UnifiedVideo[] {
  if (!Array.isArray(data)) return [];
  const videos: UnifiedVideo[] = [];
  for (const item of data) {
    const m = mapInvidiousItem(item, invidiousBase);
    if (m) videos.push(m);
    if (videos.length >= limit) break;
  }
  return videos;
}

export async function fetchTrendingVideos(
  db: AppDb,
  input: TrendingInput,
  overrides?: ProxySourceOverrides,
): Promise<TrendingVideosResult> {
  const region = input.region.toUpperCase();
  const limit = Math.min(200, input.limit ?? 40);
  const key = trendingCacheKey({ region, limit, category: input.category });
  const fresh = readFreshTrendingCache(db, key);
  if (fresh) return fresh;
  const inFlight = inFlightTrending.get(key);
  if (inFlight) return inFlight;

  const task = (async (): Promise<TrendingVideosResult> => {
    const { pipedBases, invidiousBases } =
      resolveProxyBaseCandidates(overrides);
    const errors: string[] = [];

    let resolved: TrendingVideosResult | null = null;

    for (const pipedBase of pipedBases) {
      try {
        acquireUpstreamSlot();
        const json = await fetchJson(
          buildPipedTrendingUrl(pipedBase, region, input.category),
          { emptyBodyAs: [], source: "piped", baseUrl: pipedBase },
        );
        const videos = parsePipedTrending(json, limit, pipedBase);
        if (videos.length > 0) {
          resolved = trendingVideosResultSchema.parse({
            videos,
            sourceUsed: "piped",
          });
        }
      } catch (e) {
        recordUpstreamFailure(e, "piped", errors, pipedBase);
      }
      if (resolved && resolved.videos.length > 0) break;
    }

    if (
      (!resolved || resolved.videos.length === 0) &&
      invidiousBases.length > 0
    ) {
      for (const invidiousBase of invidiousBases) {
        if (invidiousPortCollidesWithNextApp(invidiousBase)) {
          errors.push("invidious:port collision with Next.js");
          continue;
        } else {
          try {
            acquireUpstreamSlot();
            const json = await fetchJson(
              buildInvidiousTrendingUrl(invidiousBase, region, input.category),
              { emptyBodyAs: [], source: "invidious", baseUrl: invidiousBase },
            );
            const videos = parseInvidiousTrending(json, limit, invidiousBase);
            if (videos.length > 0) {
              resolved = trendingVideosResultSchema.parse({
                videos,
                sourceUsed: "invidious",
              });
            }
          } catch (e) {
            recordUpstreamFailure(e, "invidious", errors, invidiousBase);
          }
        }
        if (resolved && resolved.videos.length > 0) break;
      }
    }

    if (!resolved || resolved.videos.length === 0) {
      const stale = readStaleTrendingCache(db, key);
      if (stale) return stale;
      throwIfUpstreamFailed(errors, "trending unavailable");
    }

    const cleaned = stripRestrictedListVideos(resolved.videos);
    const out: TrendingVideosResult = {
      ...resolved,
      videos: cleaned,
    };
    const store = {
      videos: out.videos,
      sourceUsed: liveUpstreamSource(out.sourceUsed),
    };
    writeCache(db, key, store.sourceUsed, store, "trending");
    return out;
  })();
  inFlightTrending.set(key, task);
  try {
    return await task;
  } finally {
    inFlightTrending.delete(key);
  }
}

/** Piped search queries are regionalized via {@link shortsSearchQueriesForRegion}. */
const INVIDIOUS_SHORTS_SEARCH_QUERY = "#shorts";

const SHORTS_FEED_EMPTY_WARNING =
  "No shorts found for your region right now. Try again later or change trending region in Settings.";

function parseInvidiousShortsList(
  data: unknown,
  limit: number,
  invidiousBase: string,
): UnifiedVideo[] {
  if (!Array.isArray(data)) return [];
  const videos: UnifiedVideo[] = [];
  for (const item of data) {
    const m = mapInvidiousItem(item, invidiousBase);
    if (!m) continue;
    const rawType =
      item && typeof item === "object"
        ? (item as Record<string, unknown>).type
        : undefined;
    if (
      rawType === "shortVideo" ||
      invidiousItemIsDiscoveryShort(item) ||
      isDiscoveryShortVideo(m)
    ) {
      videos.push(m);
      if (videos.length >= limit) break;
    }
  }
  return videos;
}

function parsePipedShortsSearch(
  data: unknown,
  limit: number,
  pipedBase: string,
): { videos: UnifiedVideo[]; continuation: string | null } {
  const items = pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const v = mapPipedItem(item, pipedBase);
    if (!v) continue;
    if (pipedItemIsDiscoveryShort(item) || isDiscoveryShortVideo(v)) {
      videos.push(v);
      if (videos.length >= limit) break;
    }
  }
  return { videos, continuation: pipedNextPage(data) };
}

function mergeDiscoveryShortVideos(
  limit: number,
  seen: Set<string>,
  out: UnifiedVideo[],
  incoming: UnifiedVideo[],
): boolean {
  for (const v of incoming) {
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    out.push(v);
    if (out.length >= limit) return true;
  }
  return out.length >= limit;
}

function parsePipedTrendingShorts(
  data: unknown,
  limit: number,
  pipedBase: string,
): UnifiedVideo[] {
  const items = Array.isArray(data) ? data : pipedRootItems(data);
  const videos: UnifiedVideo[] = [];
  for (const item of items) {
    const v = mapPipedItem(item, pipedBase);
    if (!v) continue;
    if (pipedItemIsDiscoveryShort(item) || isDiscoveryShortVideo(v)) {
      videos.push(v);
      if (videos.length >= limit) break;
    }
  }
  return videos;
}

function invidiousShortsSearchPage(continuation: string | undefined): number {
  if (!continuation?.startsWith("inv:page:")) return 1;
  const n = Number.parseInt(continuation.slice("inv:page:".length), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function nextInvidiousShortsContinuation(
  page: number,
  got: number,
): string | null {
  // Keep paginating as long as the page yielded any shorts: search pages often
  // return fewer real shorts than the limit, and stopping there would end the
  // /shorts feed prematurely instead of advancing to the next page.
  return got > 0 ? `inv:page:${page + 1}` : null;
}

export async function fetchShortsFeed(
  db: AppDb,
  input: ShortsFeedInput,
  overrides?: ProxySourceOverrides,
): Promise<ShortsFeedResult> {
  const region = input.region.toUpperCase();
  const limit = Math.min(40, input.limit ?? 20);
  const key = shortsFeedCacheKey({ ...input, region, limit });
  const fresh = readFreshShortsFeedCache(db, key);
  // Shelf needs ~14 items; a thin cached page (e.g. from warm-cache) must not block refetch.
  if (fresh && (input.purpose !== "shelf" || fresh.videos.length >= limit)) {
    return fresh;
  }

  const inFlight = inFlightShortsFeed.get(key);
  if (inFlight) return inFlight;

  const task = (async (): Promise<ShortsFeedResult> => {
    const { pipedBases, invidiousBases } =
      resolveProxyBaseCandidates(overrides);
    const errors: string[] = [];
    let resolved: ShortsFeedResult | null = null;

    const tryInvidious = async (): Promise<ShortsFeedResult | null> => {
      for (const invidiousBase of invidiousBases) {
        if (invidiousPortCollidesWithNextApp(invidiousBase)) {
          errors.push("invidious:port collision with Next.js");
          continue;
        }
        try {
          const page = invidiousShortsSearchPage(input.continuation);
          if (!input.continuation) {
            const seen = new Set<string>();
            const videos: UnifiedVideo[] = [];
            const invidiousDiscoveryQueries = resolveShortsDiscoveryQueries(
              input,
              region,
            );
            const tasteDiscovery = (input.discoveryQueries?.length ?? 0) > 0;
            if (!tasteDiscovery) {
              try {
                acquireUpstreamSlot();
                const trendingUrl = buildInvidiousTrendingUrl(
                  invidiousBase,
                  region,
                );
                const trendingJson = await fetchJson(trendingUrl, {
                  emptyBodyAs: [],
                  source: "invidious",
                  baseUrl: invidiousBase,
                });
                mergeDiscoveryShortVideos(
                  limit,
                  seen,
                  videos,
                  parseInvidiousShortsList(trendingJson, limit, invidiousBase),
                );
              } catch (e) {
                recordUpstreamFailure(e, "invidious", errors, invidiousBase);
              }
            }
            for (const q of invidiousDiscoveryQueries) {
              if (videos.length >= limit) break;
              try {
                acquireUpstreamSlot();
                const searchUrl = buildInvidiousSearchUrl(
                  invidiousBase,
                  { q, continuation: "1", region },
                  "video",
                );
                const json = await fetchJson(searchUrl, {
                  emptyBodyAs: [],
                  source: "invidious",
                  baseUrl: invidiousBase,
                });
                const found = parseInvidiousShortsList(
                  json,
                  limit,
                  invidiousBase,
                );
                if (mergeDiscoveryShortVideos(limit, seen, videos, found))
                  break;
              } catch (e) {
                recordUpstreamFailure(e, "invidious", errors, invidiousBase);
              }
            }
            if (videos.length > 0) {
              return shortsFeedResultSchema.parse({
                videos: videos.slice(0, limit),
                continuation: nextInvidiousShortsContinuation(1, videos.length),
                sourceUsed: "invidious",
              });
            }
          }
          acquireUpstreamSlot();
          const searchUrl = buildInvidiousSearchUrl(
            invidiousBase,
            {
              q: INVIDIOUS_SHORTS_SEARCH_QUERY,
              continuation: String(page),
              region,
            },
            "video",
          );
          const json = await fetchJson(searchUrl, {
            emptyBodyAs: [],
            source: "invidious",
            baseUrl: invidiousBase,
          });
          const videos = parseInvidiousShortsList(json, limit, invidiousBase);
          if (videos.length === 0) continue;
          return shortsFeedResultSchema.parse({
            videos,
            continuation: nextInvidiousShortsContinuation(page, videos.length),
            sourceUsed: "invidious",
          });
        } catch (e) {
          recordUpstreamFailure(e, "invidious", errors, invidiousBase);
        }
      }
      return null;
    };

    const tryPiped = async (): Promise<ShortsFeedResult | null> => {
      for (const pipedBase of pipedBases) {
        const discoveryQueries = resolveShortsDiscoveryQueries(input, region);
        const tasteDiscovery = (input.discoveryQueries?.length ?? 0) > 0;

        const fetchPipedSearchShorts = async (
          q: string,
          continuation?: string,
        ): Promise<UnifiedVideo[]> => {
          try {
            acquireUpstreamSlot();
            const searchUrl = buildPipedSearchUrl(
              pipedBase,
              {
                q,
                limit: Math.min(40, limit * 3),
                continuation,
                region,
              },
              "all",
            );
            const json = await fetchJson(searchUrl, {
              source: "piped",
              baseUrl: pipedBase,
            });
            return parsePipedShortsSearch(json, limit, pipedBase).videos;
          } catch (e) {
            recordUpstreamFailure(e, "piped", errors, pipedBase);
            return [];
          }
        };

        if (!input.continuation) {
          const seen = new Set<string>();
          const videos: UnifiedVideo[] = [];

          if (!tasteDiscovery) {
            try {
              acquireUpstreamSlot();
              const trendingJson = await fetchJson(
                buildPipedTrendingUrl(pipedBase, region),
                { emptyBodyAs: [], source: "piped", baseUrl: pipedBase },
              );
              mergeDiscoveryShortVideos(
                limit,
                seen,
                videos,
                parsePipedTrendingShorts(trendingJson, limit, pipedBase),
              );
            } catch (e) {
              recordUpstreamFailure(e, "piped", errors, pipedBase);
            }
          }

          for (const q of discoveryQueries) {
            if (videos.length >= limit) break;
            const found = await fetchPipedSearchShorts(q);
            if (mergeDiscoveryShortVideos(limit, seen, videos, found)) break;
          }

          if (videos.length > 0) {
            return shortsFeedResultSchema.parse({
              videos: videos.slice(0, limit),
              continuation: "piped:search",
              sourceUsed: "piped",
            });
          }
        }

        const pipedContinuation =
          input.continuation === "piped:search"
            ? undefined
            : input.continuation?.startsWith("piped:")
              ? input.continuation.slice("piped:".length)
              : input.continuation;

        for (const q of discoveryQueries) {
          try {
            acquireUpstreamSlot();
            const searchUrl = buildPipedSearchUrl(
              pipedBase,
              {
                q,
                limit: Math.min(40, limit * 3),
                continuation: pipedContinuation,
                region,
              },
              "all",
            );
            const json = await fetchJson(searchUrl, {
              source: "piped",
              baseUrl: pipedBase,
            });
            const { videos, continuation } = parsePipedShortsSearch(
              json,
              limit,
              pipedBase,
            );
            if (videos.length === 0) continue;
            const next =
              continuation && continuation.length > 0
                ? `piped:${continuation}`
                : null;
            return shortsFeedResultSchema.parse({
              videos,
              continuation: next,
              sourceUsed: "piped",
            });
          } catch (e) {
            recordUpstreamFailure(e, "piped", errors, pipedBase);
          }
        }
      }
      return null;
    };

    const continuation = input.continuation ?? "";
    const pipedContinuation =
      continuation === "piped:search" || continuation.startsWith("piped:");
    const invidiousContinuation =
      continuation.startsWith("inv:page:") || continuation === "";

    if (invidiousContinuation) {
      resolved = await tryInvidious();
    }
    if (
      (!resolved || resolved.videos.length === 0) &&
      (pipedContinuation || !continuation)
    ) {
      const fromPiped = await tryPiped();
      if (fromPiped && fromPiped.videos.length > 0) {
        resolved = fromPiped;
      }
    }

    if (!resolved || resolved.videos.length === 0) {
      const stale = readStaleShortsFeedCache(db, key);
      if (stale && stale.videos.length > 0) return stale;
      if (errors.length > 0) {
        throwIfUpstreamFailed(errors, "shorts feed unavailable");
      }
      const fallbackSource =
        pipedBases.length > 0
          ? "piped"
          : invidiousBases.length > 0
            ? "invidious"
            : "piped";
      return shortsFeedResultSchema.parse({
        videos: [],
        continuation: null,
        sourceUsed: liveUpstreamSource(fallbackSource),
        warning: SHORTS_FEED_EMPTY_WARNING,
      });
    }

    const parsed = shortsFeedResultSchema.parse(resolved);
    const videos = filterShortsFeedVideos(parsed.videos);
    const out = { ...parsed, videos };
    if (out.videos.length === 0 && parsed.videos.length > 0) {
      const stale = readStaleShortsFeedCache(db, key);
      if (stale && stale.videos.length > 0) return stale;
    }
    if (out.videos.length > 0) {
      writeCache(
        db,
        key,
        liveUpstreamSource(out.sourceUsed),
        {
          videos: out.videos,
          continuation: out.continuation,
          sourceUsed: liveUpstreamSource(out.sourceUsed),
        },
        "shorts",
        { shortsPurpose: input.purpose ?? "feed" },
      );
    }
    return out;
  })();

  inFlightShortsFeed.set(key, task);
  try {
    return await task;
  } finally {
    inFlightShortsFeed.delete(key);
  }
}

/* -------------------------------------------------------------------------- */
/* Channel                                                                    */
/* -------------------------------------------------------------------------- */

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

export async function fetchChannelPage(
  db: AppDb,
  input: ChannelPageInput,
  overrides?: ProxySourceOverrides,
  opts?: FetchChannelPageOptions,
): Promise<ChannelPageResult> {
  const key = channelCacheKey(input);
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
  inFlightChannel.set(key, task);
  try {
    return await task;
  } finally {
    inFlightChannel.delete(key);
  }
}
