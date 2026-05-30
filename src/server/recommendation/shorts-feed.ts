import { filterShortsFeedVideos } from "@/lib/short-video";
import { shortsSearchQueriesForTaste } from "@/lib/shorts-discovery-queries";
import type { AppDb } from "@/server/db/client";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import {
  clearShortsRecommendationCacheForUser,
  getShortsRecommendations,
} from "@/server/recommendation/shorts-recommendation-pool";
import { loadShortSeenVideoIds } from "@/server/recommendation/shorts-seen";
import { collectUserSignals } from "@/server/recommendation/signals";
import { readCachedDetailTitlesForVideos } from "@/server/recommendation/taste-corpus";
import { loadWatchedVideoIdsForRecommendations } from "@/server/recommendation/watched-videos";
import {
  fetchShortsFeed,
  type ProxySourceOverrides,
} from "@/server/services/proxy";
import type {
  ShortsFeedInput,
  ShortsFeedResult,
  UnifiedVideo,
} from "@/server/services/proxy.types";
import { getUserSettings } from "@/server/settings/profile";

const SHORTS_PAGE_SIZE = 24;

const SHORTS_DISCOVERY_FETCH_LIMIT = 36;

const SHORTS_SHELF_MAX_LIMIT = 16;

/** Channel Shorts tab fetches when building the home shelf pool (cold). */
const SHORTS_SHELF_MAX_CHANNELS = 6;

const SHORTS_SHELF_DISCOVERY_PAGES = 2;

const MAX_EMPTY_REC_PAGE_SKIPS = 10;

export function parseShortsRecPage(continuation?: string): number | null {
  if (!continuation?.startsWith("rec:")) return null;
  const suffix = continuation.slice("rec:".length);
  if (suffix === "refresh") return 1;
  const n = Number.parseInt(suffix, 10);
  return Number.isFinite(n) && n >= 2 ? n : null;
}

export function shortsContinuationForcesPoolRefresh(
  continuation?: string,
): boolean {
  return continuation === "rec:refresh";
}

/** Merges DB watch history with client session exclusions for feed pagination. */
export function buildShortsExclusionSet(
  db: AppDb,
  userId: number | null,
  excludeVideoIds?: readonly string[],
): Set<string> | null {
  const merged = new Set<string>();
  if (userId) {
    for (const id of loadWatchedVideoIdsForRecommendations(db, userId)) {
      merged.add(id);
    }
    for (const id of loadShortSeenVideoIds(db, userId)) {
      merged.add(id);
    }
  }
  if (excludeVideoIds) {
    for (const id of excludeVideoIds) {
      const trimmed = id.trim();
      if (trimmed.length > 0) merged.add(trimmed);
    }
  }
  return merged.size > 0 ? merged : null;
}

function mergeShortsLists(
  limit: number,
  ...lists: UnifiedVideo[][]
): UnifiedVideo[] {
  const seen = new Set<string>();
  const out: UnifiedVideo[] = [];
  for (const list of lists) {
    for (const v of list) {
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      out.push(v);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function filterUnwatchedShorts(
  videos: UnifiedVideo[],
  watched: Set<string> | null,
): UnifiedVideo[] {
  if (!watched || watched.size === 0) return videos;
  return videos.filter((v) => !watched.has(v.videoId));
}

async function buildTasteDiscoveryQueries(
  db: AppDb,
  userId: number,
  region: string,
): Promise<string[]> {
  const settings = getUserSettings(db, userId);
  const signals = collectUserSignals(db, userId);
  const tasteTitles = readCachedDetailTitlesForVideos(
    db,
    Array.from(new Set([...signals.likedVideoIds, ...signals.savedVideoIds])),
    72,
  );
  const corpus: string[] = [];
  for (const kw of settings.tasteKeywords) {
    const k = kw.trim();
    if (k) corpus.push(k);
  }
  for (const t of tasteTitles) corpus.push(t);
  return shortsSearchQueriesForTaste(corpus, region);
}

async function resolvePersonalizedShortsPage(
  db: AppDb,
  userId: number,
  startPage: number,
  pageSize: number,
  region: string,
  overrides: ProxySourceOverrides | undefined,
  watchedEver: Set<string> | null,
  additionalExcludeVideoIds?: readonly string[],
  forcePoolRefresh?: boolean,
) {
  let page = startPage;
  const videos: UnifiedVideo[] = [];
  let hasMore = false;
  let coldStart = false;

  for (
    let skip = 0;
    skip < MAX_EMPTY_REC_PAGE_SKIPS && videos.length < pageSize;
    skip++
  ) {
    const personalized = await getShortsRecommendations(db, userId, {
      page,
      pageSize,
      region,
      overrides,
      additionalExcludeVideoIds,
      forcePoolRefresh: forcePoolRefresh && skip === 0,
    });
    coldStart = personalized.coldStart;
    hasMore = personalized.hasMore;
    for (const video of filterUnwatchedShorts(
      personalized.videos,
      watchedEver,
    )) {
      if (videos.some((v) => v.videoId === video.videoId)) continue;
      videos.push(video);
      if (videos.length >= pageSize) break;
    }
    if (!hasMore) break;
    page++;
  }

  return {
    personalized: {
      videos: videos.slice(0, pageSize),
      hasMore,
      coldStart,
    },
    page,
  };
}

const MAX_UNWATCHED_FETCH_ATTEMPTS = 20;

const ALL_SHORTS_SEEN_WARNING =
  "No new shorts right now — you have already seen the available ones.";

async function fetchUnwatchedGenericShorts(
  db: AppDb,
  input: ShortsFeedInput,
  overrides: ProxySourceOverrides | undefined,
  watchedEver: Set<string> | null,
  limit: number,
): Promise<ShortsFeedResult> {
  let continuation = input.continuation;
  const merged: UnifiedVideo[] = [];
  const seen = new Set<string>();
  let sourceUsed: ShortsFeedResult["sourceUsed"] = "piped";
  let warning: string | undefined;
  let stale: boolean | undefined;
  let upstreamUnavailable: UpstreamUnavailableError | null = null;

  for (let attempt = 0; attempt < MAX_UNWATCHED_FETCH_ATTEMPTS; attempt++) {
    let page: ShortsFeedResult;
    try {
      page = await fetchShortsFeed(db, { ...input, continuation }, overrides);
    } catch (e) {
      if (e instanceof UpstreamUnavailableError) {
        upstreamUnavailable = e;
        if (merged.length > 0) break;
        break;
      }
      throw e;
    }
    sourceUsed = page.sourceUsed;
    warning = page.warning;
    stale = page.stale;

    const unwatched = filterUnwatchedShorts(
      filterShortsFeedVideos(page.videos),
      watchedEver,
    );
    for (const video of unwatched) {
      if (seen.has(video.videoId)) continue;
      seen.add(video.videoId);
      merged.push(video);
      if (merged.length >= limit) {
        return {
          videos: merged.slice(0, limit),
          continuation: page.continuation ?? undefined,
          sourceUsed,
          warning,
          stale,
        };
      }
    }

    if (!page.continuation) {
      continuation = undefined;
      break;
    }
    continuation = page.continuation;
  }

  if (merged.length === 0 && upstreamUnavailable) {
    return {
      videos: [],
      continuation: continuation ?? undefined,
      sourceUsed,
      warning: upstreamUnavailable.message,
      stale,
    };
  }

  return {
    videos: merged,
    continuation: continuation ?? undefined,
    sourceUsed,
    warning:
      merged.length === 0 ? (warning ?? ALL_SHORTS_SEEN_WARNING) : warning,
    stale,
  };
}

/**
 * Home Shorts shelf: at most one generic upstream fetch; personalized rows only
 * when the shorts pool is already warm (e.g. after visiting `/shorts`).
 */
async function fetchShortsShelfFeed(
  db: AppDb,
  userId: number | null,
  input: ShortsFeedInput,
  overrides: ProxySourceOverrides | undefined,
  region: string,
  limit: number,
): Promise<ShortsFeedResult> {
  const watchedEver = buildShortsExclusionSet(
    db,
    userId,
    input.excludeVideoIds,
  );
  let videos: UnifiedVideo[] = [];

  if (userId) {
    const personalized = await getShortsRecommendations(db, userId, {
      page: 1,
      pageSize: limit,
      region,
      overrides,
      additionalExcludeVideoIds: input.excludeVideoIds,
      maxChannels: SHORTS_SHELF_MAX_CHANNELS,
    });
    videos = filterUnwatchedShorts(
      filterShortsFeedVideos(personalized.videos),
      watchedEver,
    );
  }

  if (videos.length >= limit) {
    return {
      videos: videos.slice(0, limit),
      sourceUsed: "piped",
    };
  }

  let sourceUsed: ShortsFeedResult["sourceUsed"] = "piped";
  let warning: string | undefined;
  let stale: boolean | undefined;
  let continuation: string | undefined;

  try {
    for (
      let pageIndex = 0;
      pageIndex < SHORTS_SHELF_DISCOVERY_PAGES && videos.length < limit;
      pageIndex++
    ) {
      const page = await fetchShortsFeed(
        db,
        {
          region,
          limit,
          continuation,
          purpose: "shelf",
          excludeVideoIds: input.excludeVideoIds,
        },
        overrides,
      );
      sourceUsed = page.sourceUsed;
      warning = page.warning;
      stale = page.stale;
      videos = mergeShortsLists(
        limit,
        videos,
        filterUnwatchedShorts(filterShortsFeedVideos(page.videos), watchedEver),
      );
      if (videos.length >= limit) break;
      if (!page.continuation) {
        continuation = undefined;
        break;
      }
      continuation = page.continuation;
    }

    return {
      videos: videos.slice(0, limit),
      continuation: undefined,
      sourceUsed,
      warning,
      stale,
    };
  } catch (e) {
    if (videos.length > 0) {
      return { videos: videos.slice(0, limit), sourceUsed: "piped" };
    }
    throw e;
  }
}

/**
 * Signed-in: shorts pool (channel Shorts tabs + same scoring as home).
 * Anonymous: generic `#shorts` / `shorts` discovery only.
 */
export async function fetchShortsFeedForViewer(
  db: AppDb,
  userId: number | null,
  input: ShortsFeedInput,
  overrides?: ProxySourceOverrides,
): Promise<ShortsFeedResult> {
  const region = input.region.toUpperCase();
  const purpose = input.purpose ?? "feed";
  const limit =
    purpose === "shelf"
      ? Math.min(SHORTS_SHELF_MAX_LIMIT, input.limit ?? SHORTS_SHELF_MAX_LIMIT)
      : Math.min(40, input.limit ?? SHORTS_PAGE_SIZE);

  if (purpose === "shelf") {
    return fetchShortsShelfFeed(db, userId, input, overrides, region, limit);
  }
  const forcePoolRefresh = shortsContinuationForcesPoolRefresh(
    input.continuation,
  );
  const recPage = parseShortsRecPage(input.continuation);
  const watchedEver = buildShortsExclusionSet(
    db,
    userId,
    input.excludeVideoIds,
  );

  const isUpstreamContinuation =
    input.continuation != null &&
    input.continuation.length > 0 &&
    !input.continuation.startsWith("rec:");

  if (!userId || isUpstreamContinuation) {
    return fetchUnwatchedGenericShorts(
      db,
      input,
      overrides,
      watchedEver,
      limit,
    );
  }

  const tasteDiscoveryQueries = await buildTasteDiscoveryQueries(
    db,
    userId,
    region,
  );
  const startPage = recPage ?? 1;
  const pageSize = Math.max(limit, SHORTS_PAGE_SIZE);
  let { personalized, page } = await resolvePersonalizedShortsPage(
    db,
    userId,
    startPage,
    pageSize,
    region,
    overrides,
    watchedEver,
    input.excludeVideoIds,
    forcePoolRefresh,
  );

  let nextRecCursor = personalized.hasMore ? `rec:${page + 1}` : undefined;

  if (page === 1 && personalized.videos.length < limit) {
    // Top up a thin personalized page with regional/taste discovery shorts so
    // the caller gets close to `limit` items from varied channels, instead of
    // returning the few channel-clustered personalized results on their own.
    const upstream = await fetchUnwatchedGenericShorts(
      db,
      {
        region,
        limit: SHORTS_DISCOVERY_FETCH_LIMIT,
        discoveryQueries: tasteDiscoveryQueries,
      },
      overrides,
      watchedEver,
      limit,
    );
    const videos = mergeShortsLists(
      limit,
      personalized.videos,
      upstream.videos,
    );
    const nextCursor =
      videos.length > 0
        ? (nextRecCursor ?? upstream.continuation ?? undefined)
        : (upstream.continuation ?? nextRecCursor ?? undefined);
    return {
      videos,
      continuation: nextCursor ?? undefined,
      sourceUsed:
        personalized.videos.length > 0 ? "piped" : upstream.sourceUsed,
      warning:
        videos.length === 0
          ? (upstream.warning ?? ALL_SHORTS_SEEN_WARNING)
          : upstream.warning,
      stale: upstream.stale,
    };
  }

  if (personalized.videos.length > 0) {
    if (personalized.hasMore) {
      return {
        videos: personalized.videos.slice(0, limit),
        continuation: nextRecCursor,
        sourceUsed: "piped",
      };
    }

    clearShortsRecommendationCacheForUser(userId);
    const refreshed = await resolvePersonalizedShortsPage(
      db,
      userId,
      1,
      pageSize,
      region,
      overrides,
      watchedEver,
      input.excludeVideoIds,
      true,
    );
    if (refreshed.personalized.videos.length > 0) {
      const refreshedCursor = refreshed.personalized.hasMore
        ? `rec:${refreshed.page + 1}`
        : "rec:refresh";
      return {
        videos: refreshed.personalized.videos.slice(0, limit),
        continuation: refreshedCursor,
        sourceUsed: "piped",
      };
    }

    const upstream = await fetchUnwatchedGenericShorts(
      db,
      {
        region,
        limit: SHORTS_DISCOVERY_FETCH_LIMIT,
        discoveryQueries: tasteDiscoveryQueries,
      },
      overrides,
      watchedEver,
      limit,
    );
    const videos = mergeShortsLists(
      limit,
      personalized.videos,
      upstream.videos,
    );
    return {
      videos,
      continuation:
        upstream.continuation ??
        (upstream.videos.length > 0 ? "rec:refresh" : undefined),
      sourceUsed: upstream.sourceUsed,
      warning:
        videos.length === 0
          ? (upstream.warning ?? ALL_SHORTS_SEEN_WARNING)
          : upstream.warning,
      stale: upstream.stale,
    };
  }

  if (personalized.hasMore) {
    return {
      videos: [],
      continuation: nextRecCursor,
      sourceUsed: "piped",
    };
  }

  clearShortsRecommendationCacheForUser(userId);
  const retry = await resolvePersonalizedShortsPage(
    db,
    userId,
    1,
    pageSize,
    region,
    overrides,
    watchedEver,
    input.excludeVideoIds,
    true,
  );
  personalized = retry.personalized;
  page = retry.page;
  nextRecCursor = personalized.hasMore ? `rec:${page + 1}` : undefined;
  if (personalized.videos.length > 0) {
    return {
      videos: personalized.videos.slice(0, limit),
      continuation: nextRecCursor ?? "rec:refresh",
      sourceUsed: "piped",
    };
  }

  return fetchUnwatchedGenericShorts(
    db,
    {
      region,
      limit,
      continuation: undefined,
      discoveryQueries: tasteDiscoveryQueries,
    },
    overrides,
    watchedEver,
    limit,
  );
}
