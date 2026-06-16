import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import { logger } from "@/lib/logger";
import { pipedRelatedListItems } from "@/lib/piped-related-items";
import {
  filterShortsFeedVideos,
  invidiousItemIsDiscoveryShort,
  isDiscoveryShortVideo,
  pipedItemIsDiscoveryShort,
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
  detailCacheKey,
  readFreshCacheRow,
  readLatestCacheRow,
  relatedCacheKey,
  shortsFeedCacheKey,
  writeCache,
} from "@/server/services/proxy/cache";
import {
  recordUpstreamFailure,
  rethrowIfInvidiousUpcoming,
  throwIfUpstreamFailed,
} from "@/server/services/proxy/errors";
import { fetchJson } from "@/server/services/proxy/http";
import {
  buildInvidiousSearchUrl,
  buildPipedSearchUrl,
  searchVideos,
} from "@/server/services/proxy/search";

export { searchVideos };
export { fetchVideoComments } from "@/server/services/proxy/comments";

import {
  buildInvidiousTrendingUrl,
  buildPipedTrendingUrl,
  clearTrendingInFlight,
} from "@/server/services/proxy/trending";

export { fetchTrendingVideos } from "@/server/services/proxy/trending";

import {
  clearChannelInFlight,
  fetchChannelPage,
} from "@/server/services/proxy/channel";

export {
  type FetchChannelPageOptions,
  fetchChannelPage,
} from "@/server/services/proxy/channel";

import {
  mapInvidiousItem,
  mapInvidiousVideo,
} from "@/server/services/proxy/mappers/invidious";
import {
  mapPipedItem,
  mapPipedStream,
  pipedNextPage,
  pipedRootItems,
} from "@/server/services/proxy/mappers/piped";
import {
  liveUpstreamSource,
  pickInvidiousStoryboard,
} from "@/server/services/proxy/normalize";
import {
  cachedShortsFeedPayloadSchema,
  type RelatedVideosResult,
  relatedVideosResultSchema,
  type ShortsFeedInput,
  type ShortsFeedResult,
  shortsFeedResultSchema,
  type UnifiedVideo,
  type VideoDetail,
  type VideoDetailInput,
  type VideoStoryboard,
  videoDetailSchema,
} from "@/server/services/proxy.types";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";

const inFlightShortsFeed = new Map<string, Promise<ShortsFeedResult>>();

export function clearProxyCaches(db: AppDb): { clearedRows: number } {
  clearTrendingInFlight();
  clearChannelInFlight();
  inFlightShortsFeed.clear();
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

/* -------------------------------------------------------------------------- */
/* Trending                                                                   */
/* -------------------------------------------------------------------------- */

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
