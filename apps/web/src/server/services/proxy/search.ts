import { invidiousPortCollidesWithNextApp } from "@/lib/invidious-port-collision";
import { logger } from "@/lib/logger";
import type { AppDb } from "@/server/db/client";
import {
  readFreshCacheRow,
  readLatestCacheRow,
  registerInFlight,
  searchCacheKey,
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
import {
  mapInvidiousChannelItem,
  mapInvidiousItem,
} from "@/server/services/proxy/mappers/invidious";
import {
  mapPipedChannelItem,
  mapPipedItem,
  pipedNextPage,
  pipedRootItems,
} from "@/server/services/proxy/mappers/piped";
import { liveUpstreamSource } from "@/server/services/proxy/normalize";
import {
  cachedSearchPayloadSchema,
  type SearchVideosInput,
  type SearchVideosResult,
  searchVideosResultSchema,
  type UnifiedChannel,
  type UnifiedVideo,
} from "@/server/services/proxy.types";
import { acquireUpstreamSlot } from "@/server/services/rate-limiter";

export function buildPipedSearchUrl(
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

export function buildInvidiousSearchUrl(
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

const inFlightSearch = new Map<string, Promise<SearchVideosResult>>();

export function clearSearchInFlight(): void {
  inFlightSearch.clear();
}

export async function searchVideos(
  db: AppDb,
  input: SearchVideosInput,
  overrides?: ProxySourceOverrides,
): Promise<SearchVideosResult> {
  const key = searchCacheKey(input);

  const cached = readFreshSearchCache(db, key);
  if (cached) return cached;

  const inFlight = inFlightSearch.get(key);
  if (inFlight) return inFlight;
  const task = searchVideosLive(db, input, key, overrides);
  registerInFlight(inFlightSearch, key, task);

  // Serve-stale-and-revalidate: an expired row answers instantly while the
  // task above refreshes the cache in the background.
  const stale = readStaleSearchCache(db, key);
  if (stale) return { ...stale, warning: undefined };
  return task;
}

async function searchVideosLive(
  db: AppDb,
  input: SearchVideosInput,
  key: string,
  overrides?: ProxySourceOverrides,
): Promise<SearchVideosResult> {
  const parsedInput = input;
  const limit = parsedInput.limit ?? 20;

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

  // Invidious is the primary upstream everywhere (it also exclusively powers
  // playback manifests/captions); Piped is fallback only.
  let resolved = await tryInvidious();
  if (
    !resolved ||
    (resolved.videos.length === 0 && (resolved.channels?.length ?? 0) === 0)
  ) {
    const fromPiped = await tryPiped();
    if (fromPiped) {
      resolved = fromPiped;
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
