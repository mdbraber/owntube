import {
  SHORTS_DISCOVERY_FALLBACK_QUERIES,
  shortsSearchQueriesForRegion,
} from "@/lib/shorts-discovery-queries";
import { searchVideos } from "@/server/catalog";
import type {
  ShortsFeedInput,
  ShortsFeedResult,
  UnifiedVideo,
} from "@/server/catalog/types";

/** Later pages come from this query's search continuations. */
const SHORTS_QUERY = "#shorts";
const CONTINUATION_PREFIX = "s:";
const DEFAULT_LIMIT = 20;
const EMPTY_WARNING =
  "No shorts found right now. Try again later or change the region in Settings.";

function discoveryQueries(input: ShortsFeedInput): string[] {
  if (input.discoveryQueries?.length) return [...input.discoveryQueries];
  const regional = shortsSearchQueriesForRegion(input.region);
  return [
    ...regional,
    ...SHORTS_DISCOVERY_FALLBACK_QUERIES.filter((q) => !regional.includes(q)),
  ];
}

/**
 * Shorts found by searching: the first page from the discovery queries
 * (regional, or the viewer's taste), later pages by following `#shorts`
 * search continuations. Only rows YouTube itself shows as Shorts count.
 */
export async function fetchShortsFeed(
  input: ShortsFeedInput,
): Promise<ShortsFeedResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const seen = new Set<string>();
  const videos: UnifiedVideo[] = [];
  const take = (found: readonly UnifiedVideo[]) => {
    for (const v of found) {
      if (!v.isShort || v.isLive || v.isUpcoming || seen.has(v.videoId))
        continue;
      seen.add(v.videoId);
      videos.push(v);
    }
  };

  const token = input.continuation?.startsWith(CONTINUATION_PREFIX)
    ? input.continuation.slice(CONTINUATION_PREFIX.length)
    : undefined;
  let next: string | null = null;
  if (token) {
    const page = await searchVideos({ q: SHORTS_QUERY, continuation: token });
    take(page.videos);
    next = page.continuation ?? null;
  } else {
    const queries = discoveryQueries(input).slice(
      0,
      input.purpose === "shelf" ? 1 : undefined,
    );
    let lastError: unknown;
    for (const q of queries) {
      if (videos.length >= limit) break;
      const page = await searchVideos({ q }).catch((error) => {
        lastError = error;
        return null;
      });
      if (!page) continue;
      take(page.videos);
      if (q === SHORTS_QUERY) next = page.continuation ?? null;
    }
    if (videos.length < limit && next === null) {
      const page = await searchVideos({ q: SHORTS_QUERY }).catch((error) => {
        lastError = error;
        return null;
      });
      if (page) {
        take(page.videos);
        next = page.continuation ?? null;
      }
    }
    if (videos.length === 0 && lastError) throw lastError;
  }
  return {
    videos: videos.slice(0, limit),
    continuation: next ? `${CONTINUATION_PREFIX}${next}` : null,
    ...(videos.length === 0 ? { warning: EMPTY_WARNING } : {}),
  };
}
