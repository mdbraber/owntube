import { filterShortsFeedVideos } from "@/lib/short-video";
import { shortsSearchQueriesForTaste } from "@/lib/shorts-discovery-queries";
import { fetchShortsFeed } from "@/server/catalog/shorts";
import type {
  ShortsFeedInput,
  ShortsFeedResult,
  UnifiedVideo,
} from "@/server/catalog/types";
import type { AppDb } from "@/server/db/client";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import {
  clearShortsRecommendationCacheForUser,
  getShortsRecommendations,
} from "@/server/recommendation/shorts-recommendation-pool";
import {
  loadAnonShortSeenVideoIds,
  loadShortSeenVideoIds,
} from "@/server/recommendation/shorts-seen";
import { collectUserSignals } from "@/server/recommendation/signals";
import { readStoredTitlesForVideos } from "@/server/recommendation/taste-corpus";
import { loadWatchedVideoIdsForRecommendations } from "@/server/recommendation/watched-videos";
import { getUserSettings } from "@/server/settings/profile";

const SHORTS_PAGE_SIZE = 24;

const SHORTS_DISCOVERY_FETCH_LIMIT = 36;

const SHORTS_SHELF_MAX_LIMIT = 20;

/** Channel Shorts tab fetches when building the home shelf pool (cold). */
const SHORTS_SHELF_MAX_CHANNELS = 6;

/**
 * Upstream pages the shelf may walk before settling. One over-fetched page
 * fills the row in practice; more pages only add blocking upstream calls on a
 * cold cache, and the top-up below still covers a starved row.
 */
const SHORTS_SHELF_DISCOVERY_PAGES = 1;

const MAX_EMPTY_REC_PAGE_SKIPS = 10;

/**
 * Cursor that recycles the generic discovery feed: it restarts the upstream
 * trending/discovery sweep so `/shorts` keeps scrolling once a single upstream
 * continuation chain is exhausted (the client's `excludeVideoIds` prevents
 * re-proposing shorts already seen). Treated like "no continuation" on input.
 */
const SHORTS_GENERIC_REFRESH_CURSOR = "shorts:refresh";

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

/**
 * Everything the viewer must not be offered again: a signed-in user's watch
 * history and seen shorts, or a signed-out viewer's seen shorts (by anonymous
 * cookie id), plus any caller-supplied ids.
 */
export function buildShortsExclusionSet(
  db: AppDb,
  userId: number | null,
  excludeVideoIds?: readonly string[],
  anonId?: string | null,
): Set<string> | null {
  const merged = new Set<string>();
  if (userId) {
    for (const id of loadWatchedVideoIdsForRecommendations(db, userId)) {
      merged.add(id);
    }
    for (const id of loadShortSeenVideoIds(db, userId)) {
      merged.add(id);
    }
  } else if (anonId) {
    for (const id of loadAnonShortSeenVideoIds(db, anonId)) {
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

/**
 * Round-robin blend: takes one from each list in turn (deduped), so the feed
 * always MIXES its lists rather than draining the first before reaching the
 * next. Used to weave a wide area of recommended/discovery shorts through the
 * subscription-driven results instead of showing subscriptions-only whenever
 * they happen to fill the page. Whichever list runs out, the rest fill from the
 * others.
 */
function interleaveShortsLists(
  limit: number,
  ...lists: UnifiedVideo[][]
): UnifiedVideo[] {
  const seen = new Set<string>();
  const out: UnifiedVideo[] = [];
  const cursor = lists.map(() => 0);
  let progressed = true;
  while (out.length < limit && progressed) {
    progressed = false;
    for (let l = 0; l < lists.length && out.length < limit; l++) {
      const list = lists[l];
      while (cursor[l] < list.length && seen.has(list[cursor[l]].videoId)) {
        cursor[l]++;
      }
      if (cursor[l] < list.length) {
        const v = list[cursor[l]];
        cursor[l]++;
        seen.add(v.videoId);
        out.push(v);
        progressed = true;
      }
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
  const tasteTitles = readStoredTitlesForVideos(
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
  watchedEver: Set<string> | null,
  limit: number,
): Promise<ShortsFeedResult> {
  let continuation =
    input.continuation === SHORTS_GENERIC_REFRESH_CURSOR
      ? undefined
      : input.continuation;
  const merged: UnifiedVideo[] = [];
  const seen = new Set<string>();
  let warning: string | undefined;
  let upstreamUnavailable: UpstreamUnavailableError | null = null;
  let hadUpstreamContent = false;

  for (let attempt = 0; attempt < MAX_UNWATCHED_FETCH_ATTEMPTS; attempt++) {
    let page: ShortsFeedResult;
    try {
      page = await fetchShortsFeed({ ...input, continuation });
    } catch (e) {
      if (e instanceof UpstreamUnavailableError) {
        upstreamUnavailable = e;
        if (merged.length > 0) break;
        break;
      }
      throw e;
    }
    warning = page.warning;

    const filtered = filterShortsFeedVideos(page.videos);
    if (filtered.length > 0) hadUpstreamContent = true;
    const unwatched = filterUnwatchedShorts(filtered, watchedEver);
    for (const video of unwatched) {
      if (seen.has(video.videoId)) continue;
      seen.add(video.videoId);
      merged.push(video);
      if (merged.length >= limit) {
        return {
          videos: merged.slice(0, limit),
          // Recycle discovery once the upstream chain ends so the feed keeps
          // scrolling instead of dead-ending on a full page.
          continuation: page.continuation ?? SHORTS_GENERIC_REFRESH_CURSOR,
          warning,
        };
      }
    }

    if (!page.continuation) {
      continuation = undefined;
      break;
    }
    continuation = page.continuation;
  }

  // Recycle fallback: upstream returned content but the seen filter blocked it
  // all. Restart without the filter so the feed never dead-ends — the client's
  // own duplicate guard (seen.has) prevents re-showing already-scrolled slides.
  if (merged.length === 0 && hadUpstreamContent && watchedEver !== null) {
    return fetchUnwatchedGenericShorts(
      db,
      { ...input, continuation: undefined },
      null,
      limit,
    );
  }

  if (merged.length === 0 && upstreamUnavailable) {
    return {
      videos: [],
      continuation: continuation ?? undefined,
      warning: upstreamUnavailable.message,
    };
  }

  return {
    videos: merged,
    // While we still surfaced fresh shorts, keep the feed alive with a recycle
    // cursor; only stop (undefined) once a pass yields nothing new to scroll.
    continuation:
      continuation ??
      (merged.length > 0 ? SHORTS_GENERIC_REFRESH_CURSOR : undefined),
    warning:
      merged.length === 0 ? (warning ?? ALL_SHORTS_SEEN_WARNING) : warning,
  };
}

/**
 * Taste-aware discovery top-up: fills a thin personalized page with regional /
 * taste discovery shorts, filtered against the viewer's watch+seen set. Shared
 * by every `fetchShortsFeedForViewer` branch that needs to round out a page.
 */
function fetchTasteDiscoveryShorts(
  db: AppDb,
  region: string,
  discoveryQueries: string[],
  watchedEver: Set<string> | null,
  limit: number,
  fetchLimit: number = SHORTS_DISCOVERY_FETCH_LIMIT,
): Promise<ShortsFeedResult> {
  return fetchUnwatchedGenericShorts(
    db,
    { region, limit: fetchLimit, discoveryQueries },
    watchedEver,
    limit,
  );
}

/** The `fetchShortsFeed` limit behind a shelf of `limit` shorts. */
export function shelfUpstreamLimit(limit: number): number {
  return Math.min(40, limit * 2);
}

/**
 * Home Shorts shelf: at most one generic upstream fetch; personalized rows only
 * when the shorts pool is already warm (e.g. after visiting `/shorts`).
 */
async function fetchShortsShelfFeed(
  db: AppDb,
  userId: number | null,
  input: ShortsFeedInput,
  region: string,
  limit: number,
  anonId: string | null,
): Promise<ShortsFeedResult> {
  const watchedEver = buildShortsExclusionSet(
    db,
    userId,
    input.excludeVideoIds,
    anonId,
  );
  let videos: UnifiedVideo[] = [];
  /** Tracks whether the watched/seen filter actually removed shelf candidates. */
  let exclusionDroppedAny = false;

  if (userId) {
    const personalized = await getShortsRecommendations(db, userId, {
      page: 1,
      pageSize: limit,
      region,
      additionalExcludeVideoIds: input.excludeVideoIds,
      maxChannels: SHORTS_SHELF_MAX_CHANNELS,
    });
    const shortsOnly = filterShortsFeedVideos(personalized.videos);
    videos = filterUnwatchedShorts(shortsOnly, watchedEver);
    if (videos.length < shortsOnly.length) exclusionDroppedAny = true;
  }

  if (videos.length >= limit) {
    return {
      videos: videos.slice(0, limit),
    };
  }
  let warning: string | undefined;
  let continuation: string | undefined;

  try {
    for (
      let pageIndex = 0;
      pageIndex < SHORTS_SHELF_DISCOVERY_PAGES && videos.length < limit;
      pageIndex++
    ) {
      const page = await fetchShortsFeed({
        region,
        // Over-fetch: channel diversity (≤2/channel) and seen/watched filtering
        // thin the result, so pull a wider pool to keep the row full.
        limit: shelfUpstreamLimit(limit),
        continuation,
        purpose: "shelf",
        excludeVideoIds: input.excludeVideoIds,
      });
      warning = page.warning;
      const pageShorts = filterShortsFeedVideos(page.videos);
      const pageUnwatched = filterUnwatchedShorts(pageShorts, watchedEver);
      if (pageUnwatched.length < pageShorts.length) exclusionDroppedAny = true;
      videos = mergeShortsLists(limit, videos, pageUnwatched);
      if (videos.length >= limit) break;
      if (!page.continuation) {
        continuation = undefined;
        break;
      }
      continuation = page.continuation;
    }

    // Shelf top-up: when seen/watched filtering starves the row (heavy watch
    // histories exclude most of regional trending), refill from the upstream
    // pool without the watched/seen exclusion — only home-feed duplicates stay
    // excluded. Re-showing an already-seen short beats rendering a 2-item row.
    // Skipped when nothing was filtered out: a refetch could not add anything.
    if (videos.length < limit && exclusionDroppedAny) {
      try {
        const fallback = await fetchShortsFeed({
          region,
          limit: shelfUpstreamLimit(limit),
          purpose: "shelf",
        });
        const homeFeedIds = new Set(
          (input.excludeVideoIds ?? []).map((id) => id.trim()),
        );
        const hadFreshVideos = videos.length > 0;
        videos = mergeShortsLists(
          limit,
          videos,
          filterShortsFeedVideos(fallback.videos).filter(
            (v) => !homeFeedIds.has(v.videoId),
          ),
        );
        if (!hadFreshVideos) {
          warning = fallback.warning;
        }
      } catch (_) {
        // Top-up failed silently — a partial shelf is acceptable
      }
    }

    return {
      videos: videos.slice(0, limit),
      continuation: undefined,
      warning,
    };
  } catch (e) {
    if (videos.length > 0) {
      return { videos: videos.slice(0, limit) };
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
  /** Signed-out viewer's anonymous id; ignored when `userId` is set. */
  anonId: string | null = null,
): Promise<ShortsFeedResult> {
  const region = input.region.toUpperCase();
  const purpose = input.purpose ?? "feed";
  const limit =
    purpose === "shelf"
      ? Math.min(SHORTS_SHELF_MAX_LIMIT, input.limit ?? SHORTS_SHELF_MAX_LIMIT)
      : Math.min(40, input.limit ?? SHORTS_PAGE_SIZE);

  if (purpose === "shelf") {
    return fetchShortsShelfFeed(db, userId, input, region, limit, anonId);
  }
  const forcePoolRefresh = shortsContinuationForcesPoolRefresh(
    input.continuation,
  );
  const recPage = parseShortsRecPage(input.continuation);
  const watchedEver = buildShortsExclusionSet(
    db,
    userId,
    input.excludeVideoIds,
    anonId,
  );

  const isUpstreamContinuation =
    input.continuation != null &&
    input.continuation.length > 0 &&
    !input.continuation.startsWith("rec:");

  if (!userId || isUpstreamContinuation) {
    return fetchUnwatchedGenericShorts(db, input, watchedEver, limit);
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
    watchedEver,
    input.excludeVideoIds,
    forcePoolRefresh,
  );

  let nextRecCursor = personalized.hasMore ? `rec:${page + 1}` : undefined;

  if (page === 1) {
    // Always blend a wide area of recommended/discovery shorts (regional +
    // taste queries) INTO the subscription-driven personalized results, rather
    // than only topping up a thin page. Interleaved so the feed opens as a mix
    // instead of subscriptions-only whenever subscriptions fill the page.
    const upstream = await fetchTasteDiscoveryShorts(
      db,
      region,
      tasteDiscoveryQueries,
      watchedEver,
      limit,
    );
    const videos = interleaveShortsLists(
      limit,
      personalized.videos,
      upstream.videos,
    );
    const nextCursor =
      videos.length > 0
        ? (nextRecCursor ?? upstream.continuation ?? "rec:refresh")
        : (upstream.continuation ?? nextRecCursor ?? undefined);
    return {
      videos,
      continuation: nextCursor ?? undefined,
      warning:
        videos.length === 0
          ? (upstream.warning ?? ALL_SHORTS_SEEN_WARNING)
          : upstream.warning,
    };
  }

  if (personalized.videos.length > 0) {
    if (personalized.hasMore) {
      // Blend discovery into later pages too — not just page 1 — so scrolling
      // doesn't narrow to subscriptions-only from the handful of channels that
      // actually post shorts. Mirrors the page-1 interleave above.
      const upstream = await fetchTasteDiscoveryShorts(
        db,
        region,
        tasteDiscoveryQueries,
        watchedEver,
        limit,
      );
      const videos = interleaveShortsLists(
        limit,
        personalized.videos,
        upstream.videos,
      );
      return {
        videos,
        continuation: nextRecCursor ?? upstream.continuation ?? "rec:refresh",
        warning: upstream.warning,
      };
    }

    clearShortsRecommendationCacheForUser(userId);
    const refreshed = await resolvePersonalizedShortsPage(
      db,
      userId,
      1,
      pageSize,
      region,
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
      };
    }

    const upstream = await fetchTasteDiscoveryShorts(
      db,
      region,
      tasteDiscoveryQueries,
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
        (videos.length > 0 ? "rec:refresh" : undefined),
      warning:
        videos.length === 0
          ? (upstream.warning ?? ALL_SHORTS_SEEN_WARNING)
          : upstream.warning,
    };
  }

  if (personalized.hasMore) {
    return {
      videos: [],
      continuation: nextRecCursor,
    };
  }

  clearShortsRecommendationCacheForUser(userId);
  const retry = await resolvePersonalizedShortsPage(
    db,
    userId,
    1,
    pageSize,
    region,
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
    };
  }

  return fetchTasteDiscoveryShorts(
    db,
    region,
    tasteDiscoveryQueries,
    watchedEver,
    limit,
    limit,
  );
}
