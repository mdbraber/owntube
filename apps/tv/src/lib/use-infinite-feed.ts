import { useInfiniteQuery } from "@tanstack/react-query";
import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useMemo } from "react";
import { errorMessage } from "@/lib/use-query";

/** One fetched page: the videos plus the cursor for the next page (or none). */
export type FeedPage<C> = { items: UnifiedVideo[]; next: C | undefined };

export type InfiniteFeed = {
  videos: UnifiedVideo[];
  status: "loading" | "error" | "ready";
  message: string;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
};

/**
 * Cursor-paginated feed over react-query.
 *
 * A thin adapter, not a cache: react-query owns dedup, staleness, retry,
 * garbage collection and persistence (lib/query-client), matching how the web
 * app fetches. It exists only because our procedures disagree about what a
 * cursor is called — `page`, `cursor`, `continuation` — so tRPC's own
 * useInfiniteQuery, which requires an input field named `cursor`, cannot wrap
 * them all. `fetchPage` gets `undefined` for the first page and whatever the
 * previous page returned thereafter.
 *
 * Dedupes by videoId because upstream pages can overlap.
 */
export function useInfiniteFeed<C>(
  fetchPage: (cursor: C | undefined) => Promise<FeedPage<C>>,
  deps: readonly unknown[],
  /** Cache key; without one the feed is never shared or persisted. */
  cacheKey?: string,
): InfiniteFeed {
  const query = useInfiniteQuery({
    // deps identify the variant (channel id, selected tag, search term). The
    // key is stable across remounts, so revisiting a screen hits the cache.
    queryKey: ["feed", cacheKey ?? "anonymous", ...deps],
    queryFn: ({ pageParam }) => fetchPage(pageParam as C | undefined),
    initialPageParam: undefined as C | undefined,
    getNextPageParam: (lastPage: FeedPage<C>) => lastPage.next,
    // Un-keyed feeds are per-caller: don't retain them for someone else.
    gcTime: cacheKey ? undefined : 0,
  });

  const videos = useMemo(() => {
    const seen = new Set<string>();
    const out: UnifiedVideo[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const video of page.items) {
        if (seen.has(video.videoId)) continue;
        seen.add(video.videoId);
        out.push(video);
      }
    }
    return out;
  }, [query.data]);

  // Keep showing cached pages when a background refresh fails: an error screen
  // over good data is worse than data that is slightly stale.
  const status: InfiniteFeed["status"] =
    query.isPending && videos.length === 0
      ? "loading"
      : query.isError && videos.length === 0
        ? "error"
        : "ready";

  return {
    videos,
    status,
    message: query.error ? errorMessage(query.error) : "",
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
  };
}
