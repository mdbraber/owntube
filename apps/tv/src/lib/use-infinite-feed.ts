import type { UnifiedVideo } from "@web/server/services/proxy.types";
import { useCallback, useEffect, useRef, useState } from "react";
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
 * Cursor-paginated feed accumulator over the vanilla tRPC client. `fetchPage`
 * receives `undefined` for the first page and whatever cursor the previous page
 * returned thereafter — works for page numbers (home/history), continuation
 * tokens (search/channel), or no pagination at all (`next: undefined`).
 *
 * Dedupes by videoId because upstream pages can overlap.
 */
export function useInfiniteFeed<C>(
  fetchPage: (cursor: C | undefined) => Promise<FeedPage<C>>,
  deps: readonly unknown[],
): InfiniteFeed {
  const [videos, setVideos] = useState<UnifiedVideo[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Always call the latest fetchPage (it closes over query/channelId) without
  // making loadMore depend on its identity.
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const cursorRef = useRef<C | undefined>(undefined);
  const hasMoreRef = useRef(true);
  // Generation guard: ignore resolutions from a superseded deps change.
  const genRef = useRef(0);

  useEffect(() => {
    const gen = ++genRef.current;
    setStatus("loading");
    setVideos([]);
    setLoadingMore(false);
    setHasMore(true);
    cursorRef.current = undefined;
    hasMoreRef.current = true;
    fetchRef.current(undefined).then(
      (page) => {
        if (gen !== genRef.current) return;
        setVideos(page.items);
        cursorRef.current = page.next;
        hasMoreRef.current = page.next !== undefined;
        setHasMore(hasMoreRef.current);
        setStatus("ready");
      },
      (err: unknown) => {
        if (gen !== genRef.current) return;
        setMessage(errorMessage(err));
        setStatus("error");
      },
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps are explicit
  }, deps);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMoreRef.current || genRef.current === 0) return;
    const gen = genRef.current;
    setLoadingMore(true);
    fetchRef.current(cursorRef.current).then(
      (page) => {
        if (gen !== genRef.current) return;
        setVideos((prev) => {
          const seen = new Set(prev.map((v) => v.videoId));
          return [...prev, ...page.items.filter((v) => !seen.has(v.videoId))];
        });
        cursorRef.current = page.next;
        hasMoreRef.current = page.next !== undefined;
        setHasMore(hasMoreRef.current);
        setLoadingMore(false);
      },
      () => {
        if (gen === genRef.current) setLoadingMore(false);
      },
    );
  }, [loadingMore]);

  return { videos, status, message, loadingMore, hasMore, loadMore };
}
