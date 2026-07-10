import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import { logger } from "@/lib/logger";
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
import type { AppDb } from "@/server/db/client";
import {
  readFreshCacheRow,
  readLatestCacheRow,
  registerInFlight,
  shortsFeedCacheKey,
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
import { fetchJson } from "@/server/services/proxy/http";
import { mapInvidiousItem } from "@/server/services/proxy/mappers/invidious";
import {
  mapPipedItem,
  pipedNextPage,
  pipedRootItems,
} from "@/server/services/proxy/mappers/piped";
import { liveUpstreamSource } from "@/server/services/proxy/normalize";
import {
  buildInvidiousSearchUrl,
  buildPipedSearchUrl,
} from "@/server/services/proxy/search";
import {
  buildInvidiousTrendingUrl,
  buildPipedTrendingUrl,
} from "@/server/services/proxy/trending";
import {
  cachedShortsFeedPayloadSchema,
  type ShortsFeedInput,
  type ShortsFeedResult,
  shortsFeedResultSchema,
  type UnifiedVideo,
} from "@/server/services/proxy.types";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";

const inFlightShortsFeed = new Map<string, Promise<ShortsFeedResult>>();

export function clearShortsInFlight(): void {
  inFlightShortsFeed.clear();
}

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

  registerInFlight(inFlightShortsFeed, key, task);

  // Serve-stale-and-revalidate: an expired row answers instantly while the
  // task above refreshes the cache in the background. Mirrors the fresh-read
  // shelf condition — a thin cached shelf page must not mask the refetch.
  const stale = readStaleShortsFeedCache(db, key);
  if (stale && (input.purpose !== "shelf" || stale.videos.length >= limit)) {
    return { ...stale, warning: undefined };
  }
  return task;
}
