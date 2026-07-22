import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import { logger } from "@/lib/logger";
import { pipedRelatedListItems } from "@/lib/piped-related-items";
import {
  pickLivePlaybackDetail,
  pickRicherPlaybackDetail,
  playbackCatalogMaxHeightPx,
  shouldPreferInvidiousOverPiped,
} from "@/lib/upstream-playback-catalog";
import type { AppDb } from "@/server/db/client";
import {
  detailCacheKey,
  readFreshCacheRow,
  readLatestCacheRow,
  registerInFlight,
  relatedCacheKey,
  writeCache,
} from "@/server/services/proxy/cache";
import { fetchChannelPage } from "@/server/services/proxy/channel";
import {
  type ProxySourceOverrides,
  resolveProxyBaseCandidates,
} from "@/server/services/proxy/config";
import {
  recordUpstreamFailure,
  rethrowIfInvidiousUpcoming,
  throwIfUpstreamFailed,
} from "@/server/services/proxy/errors";
import { fetchJson } from "@/server/services/proxy/http";
import {
  mapInvidiousItem,
  mapInvidiousVideo,
} from "@/server/services/proxy/mappers/invidious";
import {
  mapPipedItem,
  mapPipedStream,
} from "@/server/services/proxy/mappers/piped";
import {
  liveUpstreamSource,
  pickInvidiousStoryboard,
} from "@/server/services/proxy/normalize";
import { searchVideos } from "@/server/services/proxy/search";
import {
  type RelatedVideosResult,
  relatedVideosResultSchema,
  type UnifiedVideo,
  type VideoDetail,
  type VideoDetailInput,
  type VideoStoryboard,
  videoDetailSchema,
} from "@/server/services/proxy.types";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";

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

/**
 * Synchronous cache-only peek: returns the fresh cached VideoDetail when
 * present, else null. Never touches upstream, so it's safe to call during SSR
 * to seed a client query — a warm short gets instant playback, a cold one just
 * returns null and the client resolves it (no page-blocking network wait).
 */
export function peekFreshVideoDetail(
  db: AppDb,
  input: VideoDetailInput,
): VideoDetail | null {
  return readFreshDetailCache(db, detailCacheKey(input));
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
        // Invidious answers 200 with `{"error": "…"}` for videos YouTube
        // refuses (region block, private, removed). mapInvidiousVideo would
        // silently return null and drop the reason — throw it instead so the
        // error classification below can relay YouTube's own words.
        const upstreamReason =
          json && typeof json === "object" && !Array.isArray(json)
            ? (json as Record<string, unknown>).error
            : undefined;
        if (typeof upstreamReason === "string" && upstreamReason.trim()) {
          throw new Error(upstreamReason.trim());
        }
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

const inFlightRelated = new Map<string, Promise<RelatedVideosResult>>();

export function clearRelatedInFlight(): void {
  inFlightRelated.clear();
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

  const inFlight = inFlightRelated.get(key);
  if (inFlight) return inFlight;
  const task = fetchRelatedVideosLive(db, input, key, limit, overrides);
  registerInFlight(inFlightRelated, key, task);

  // Serve-stale-and-revalidate: an expired row answers instantly while the
  // task above refreshes the cache in the background.
  const stale = readStaleRelatedCache(db, key);
  if (stale) return { ...stale, warning: undefined };
  return task;
}

async function fetchRelatedVideosLive(
  db: AppDb,
  input: VideoDetailInput,
  key: string,
  limit: number,
  overrides?: ProxySourceOverrides,
): Promise<RelatedVideosResult> {
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
