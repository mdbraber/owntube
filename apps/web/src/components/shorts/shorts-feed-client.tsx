"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShortsEmptyHint } from "@/components/shorts/shorts-empty-hint";
import { ShortsPreloader } from "@/components/shorts/shorts-preloader";
import { ShortsSlide } from "@/components/shorts/shorts-slide";
import {
  readSeenShortIds,
  recordSeenShortIds,
} from "@/lib/shorts-seen-storage";
import type { UpstreamAvailability } from "@/server/services/proxy";
import type {
  ShortsFeedResult,
  UnifiedVideo,
  VideoDetail,
} from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

type ShortsFeedClientProps = {
  region: string;
  initialVideoId?: string;
  initialFeed?: ShortsFeedResult | null;
  /** Server-resolved detail for the first short, seeded so it plays at once. */
  initialDetail?: VideoDetail | null;
  initialUpstream?: UpstreamAvailability;
  initialWatchedVideoIds?: string[];
  signedIn?: boolean;
};

/** How many upcoming shorts to resolve stream URLs for ahead of the active one. */
const SHORTS_DETAIL_PREFETCH_AHEAD = 4;

/** How many upcoming shorts to warm the stream/manifest bytes for (aggressive
 *  background loading so several swipes ahead start instantly). */
const SHORTS_PRELOAD_AHEAD = 3;

function filterExcludedVideos(
  videos: UnifiedVideo[],
  excluded: Set<string>,
): UnifiedVideo[] {
  if (excluded.size === 0) return videos;
  return videos.filter((v) => !excluded.has(v.videoId));
}

function activeIndexFromScroll(
  scrollTop: number,
  slideHeight: number,
  maxIndex: number,
) {
  if (slideHeight <= 0) return 0;
  return Math.min(maxIndex, Math.max(0, Math.round(scrollTop / slideHeight)));
}

function mergeFeedPages(
  pages: { videos: UnifiedVideo[] }[] | undefined,
): UnifiedVideo[] {
  if (!pages) return [];
  const merged: UnifiedVideo[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const v of page.videos) {
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      merged.push(v);
    }
  }
  return merged;
}

export function ShortsFeedClient({
  region,
  initialVideoId,
  initialFeed,
  initialDetail,
  initialUpstream,
  initialWatchedVideoIds = [],
  signedIn = false,
}: ShortsFeedClientProps) {
  const [excludedIds, setExcludedIds] = useState(
    () => new Set(initialWatchedVideoIds),
  );
  const [items, setItems] = useState<UnifiedVideo[]>(() => {
    const raw = initialFeed?.videos?.length ? initialFeed.videos : [];
    return filterExcludedVideos(raw, new Set(initialWatchedVideoIds));
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [recycleMode, setRecycleMode] = useState(false);
  const recycleModeRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const loadMoreCooldownRef = useRef(0);
  const itemsCountBeforeFetchRef = useRef(0);
  const stallRetriesRef = useRef(0);
  const prevActiveVideoIdRef = useRef<string | null>(null);
  const activeVideoMetaRef = useRef(new Map<string, UnifiedVideo>());
  const recordedShortIdsRef = useRef(new Set(initialWatchedVideoIds));
  const excludedIdsRef = useRef(excludedIds);
  excludedIdsRef.current = excludedIds;

  const router = useRouter();
  const exitShorts = useCallback(() => {
    // Back to wherever they came from; fall back to home on a cold entry.
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [router]);

  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery();
  const preloadNext = settingsQuery.data?.shortsPreloadNext ?? true;
  const seenIdsQuery = trpc.shorts.seenVideoIds.useQuery(undefined, {
    enabled: signedIn,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const watchedQuery = trpc.history.watchedVideoIds.useQuery(undefined, {
    enabled: signedIn,
    staleTime: 30_000,
  });
  const excludeVideoIds = useMemo(
    () => [...excludedIds].slice(-200),
    [excludedIds],
  );

  const markShortSeenPendingRef = useRef(new Set<string>());

  const { mutate: markShortSeenMutation } = trpc.shorts.markSeen.useMutation({
    onSuccess: (_data, variables) => {
      recordedShortIdsRef.current.add(variables.videoId);
      markShortSeenPendingRef.current.delete(variables.videoId);
      void utils.shorts.seenVideoIds.invalidate();
      void utils.shorts.feed.invalidate();
    },
    onError: (_err, variables) => {
      markShortSeenPendingRef.current.delete(variables.videoId);
    },
  });

  const addExcludedId = useCallback((videoId: string) => {
    setExcludedIds((prev) => {
      if (prev.has(videoId)) return prev;
      const next = new Set(prev);
      next.add(videoId);
      return next;
    });
  }, []);

  // Locally-persisted seen shorts: exclude them and drop them from the initial
  // feed so a return visit does not re-scroll the same shorts.
  useEffect(() => {
    const localSeen = readSeenShortIds();
    if (localSeen.length === 0) return;
    const seenSet = new Set(localSeen);
    for (const id of localSeen) recordedShortIdsRef.current.add(id);
    setExcludedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of localSeen) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setItems((prev) => {
      const filtered = prev.filter((v) => !seenSet.has(v.videoId));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, []);

  useEffect(() => {
    if (!seenIdsQuery.data?.length) return;
    setExcludedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of seenIdsQuery.data) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    for (const id of seenIdsQuery.data) {
      recordedShortIdsRef.current.add(id);
    }
  }, [seenIdsQuery.data]);

  useEffect(() => {
    if (!watchedQuery.data?.length) return;
    setExcludedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of watchedQuery.data) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [watchedQuery.data]);

  const markShortSeen = useCallback(
    (video: UnifiedVideo) => {
      const id = video.videoId;
      if (recordedShortIdsRef.current.has(id)) return;
      recordedShortIdsRef.current.add(id);
      addExcludedId(id);
      // Persist locally so returning to /shorts never re-proposes this short,
      // even for anonymous viewers (the server only tracks signed-in users).
      recordSeenShortIds([id]);
      if (!signedIn || markShortSeenPendingRef.current.has(id)) return;
      markShortSeenPendingRef.current.add(id);
      markShortSeenMutation({
        videoId: id,
        channelId: video.channelId ?? "unknown",
      });
    },
    [addExcludedId, markShortSeenMutation, signedIn],
  );

  const feed = trpc.shorts.feed.useInfiniteQuery(
    { region, limit: 24, excludeVideoIds },
    {
      staleTime: 0,
      refetchOnMount: signedIn ? "always" : false,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      initialData:
        initialFeed && initialFeed.videos.length > 0
          ? {
              pages: [
                {
                  videos: filterExcludedVideos(
                    initialFeed.videos,
                    new Set(initialWatchedVideoIds),
                  ),
                  nextCursor: initialFeed.continuation ?? undefined,
                  sourceUsed: initialFeed.sourceUsed,
                  warning: initialFeed.warning,
                  stale: initialFeed.stale,
                  upstream: initialUpstream ?? {
                    pipedConfigured: false,
                    invidiousConfigured: false,
                    anyConfigured: false,
                  },
                },
              ],
              pageParams: [undefined],
            }
          : undefined,
      retry: (failureCount, error) => {
        if (error.data?.code === "TOO_MANY_REQUESTS") return false;
        return failureCount < 1;
      },
    },
  );

  // Append new upstream pages only — never drop slides already in the feed (watching
  // marks them excluded for pagination, but removing them breaks scroll snap).
  // In recycleMode the seen/recorded filters are relaxed so the feed never
  // dead-ends when the upstream pool is exhausted: the seen.has() guard still
  // prevents re-adding slides already visible in the current scroll list.
  useEffect(() => {
    if (!feed.isSuccess) return;
    const merged = mergeFeedPages(feed.data.pages);
    const excluded = excludedIdsRef.current;
    // recordedShortIdsRef holds locally-persisted seen ids synchronously (refs
    // update before the excludedIds state re-render), so already-seen shorts are
    // never re-added on mount.
    const recorded = recordedShortIdsRef.current;
    setItems((prev) => {
      const seen = new Set(prev.map((v) => v.videoId));
      const added: UnifiedVideo[] = [];
      for (const v of merged) {
        if (seen.has(v.videoId)) continue;
        // Outside recycle mode skip content the user has already seen; in
        // recycle mode accept it (the feed must never show nothing).
        if (
          !recycleMode &&
          (excluded.has(v.videoId) || recorded.has(v.videoId))
        ) {
          continue;
        }
        seen.add(v.videoId);
        added.push(v);
      }
      if (added.length === 0) return prev;
      return [...prev, ...added];
    });
  }, [feed.data, feed.isSuccess, recycleMode]);

  useEffect(() => {
    setActiveIndex((prev) => Math.min(prev, Math.max(0, items.length - 1)));
  }, [items.length]);

  const loadMore = useCallback(() => {
    const now = Date.now();
    if (now - loadMoreCooldownRef.current < 1200) return;
    if (loadingMoreRef.current) return;
    if (!feed.hasNextPage || feed.isFetchingNextPage) return;
    loadingMoreRef.current = true;
    loadMoreCooldownRef.current = now;
    itemsCountBeforeFetchRef.current = items.length;
    void feed
      .fetchNextPage()
      .then(() => setLoadMoreError(null))
      .catch((err: Error) => {
        setLoadMoreError(err.message);
      })
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, [feed, items.length]);

  useEffect(() => {
    if (feed.isFetchingNextPage) return;
    if (!feed.isSuccess || !feed.hasNextPage) return;
    const before = itemsCountBeforeFetchRef.current;
    if (before === 0) return;
    if (items.length > before) {
      stallRetriesRef.current = 0;
      return;
    }
    if (stallRetriesRef.current >= 5) return;
    stallRetriesRef.current += 1;
    // After 3 stall retries with no new items, switch to recycle mode so the
    // items effect accepts server-recycled content and the feed keeps scrolling.
    if (stallRetriesRef.current >= 3 && !recycleModeRef.current) {
      recycleModeRef.current = true;
      setRecycleMode(true);
    }
    loadMore();
  }, [
    feed.hasNextPage,
    feed.isFetchingNextPage,
    feed.isSuccess,
    items.length,
    loadMore,
  ]);

  const syncActiveFromScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root || items.length === 0) return;
    const slideHeight = root.clientHeight;
    if (slideHeight <= 0) return;
    const idx = activeIndexFromScroll(
      root.scrollTop,
      slideHeight,
      items.length - 1,
    );
    setActiveIndex((prev) => (prev === idx ? prev : idx));
    if (idx >= items.length - 4) loadMore();
  }, [items.length, loadMore]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || items.length === 0) return;

    const onScroll = () => syncActiveFromScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    syncActiveFromScroll();

    const ro = new ResizeObserver(() => syncActiveFromScroll());
    ro.observe(root);

    return () => {
      root.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [items.length, syncActiveFromScroll]);

  useEffect(() => {
    if (!initialVideoId || items.length === 0) return;
    const idx = Array.prototype.findIndex.call(
      items,
      (v) => v.videoId === initialVideoId,
    );
    if (idx < 0) return;
    const root = scrollRef.current;
    if (!root) return;
    const slideHeight = root.clientHeight;
    if (slideHeight <= 0) return;
    root.scrollTo({ top: idx * slideHeight, behavior: "auto" });
    setActiveIndex((prev) => (prev === idx ? prev : idx));
  }, [initialVideoId, items]);

  const activeVideoId = items[activeIndex]?.videoId;

  useEffect(() => {
    const currentVideo = items.find((v) => v.videoId === activeVideoId);
    if (currentVideo) {
      activeVideoMetaRef.current.set(currentVideo.videoId, currentVideo);
    }
    const prevId = prevActiveVideoIdRef.current;
    if (prevId && prevId !== activeVideoId) {
      const prevVideo = activeVideoMetaRef.current.get(prevId);
      if (prevVideo) markShortSeen(prevVideo);
    }
    prevActiveVideoIdRef.current = activeVideoId ?? null;
  }, [activeVideoId, items, markShortSeen]);

  useEffect(() => {
    if (!signedIn) return;
    const flushActiveShort = () => {
      const id = activeVideoId ?? prevActiveVideoIdRef.current;
      if (!id) return;
      const video =
        activeVideoMetaRef.current.get(id) ??
        items.find((v) => v.videoId === id);
      if (video) markShortSeen(video);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushActiveShort();
    };
    window.addEventListener("pagehide", flushActiveShort);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushActiveShort);
      document.removeEventListener("visibilitychange", onVisibility);
      flushActiveShort();
    };
  }, [activeVideoId, items, markShortSeen, signedIn]);

  useEffect(() => {
    if (items.length === 0) return;
    if (items.length <= 10 && feed.hasNextPage && !feed.isFetchingNextPage) {
      loadMore();
    }
  }, [items.length, feed.hasNextPage, feed.isFetchingNextPage, loadMore]);

  // Resolve stream URLs (the dominant per-short latency — an upstream
  // Piped/Invidious resolve) for the next few shorts so scrolling forward,
  // including a quick double-swipe past the immediate next slide, starts
  // playback without waiting. Detail queries still fresh in cache are reused,
  // so re-running this on every active-index change is cheap.
  useEffect(() => {
    for (let offset = 1; offset <= SHORTS_DETAIL_PREFETCH_AHEAD; offset++) {
      const id = items[activeIndex + offset]?.videoId;
      if (id) void utils.video.detail.prefetch({ videoId: id });
    }
  }, [items, activeIndex, utils.video.detail]);

  const upstream = feed.data?.pages[feed.data.pages.length - 1]?.upstream ??
    initialUpstream ?? {
      pipedConfigured: false,
      invidiousConfigured: false,
      anyConfigured: false,
    };
  const feedWarning =
    feed.data?.pages[feed.data.pages.length - 1]?.warning ?? undefined;

  const scrollToIndex = useCallback(
    (index: number) => {
      const root = scrollRef.current;
      if (!root || items.length === 0) return;
      const slideHeight = root.clientHeight;
      if (slideHeight <= 0) return;
      const clamped = Math.min(items.length - 1, Math.max(0, index));
      root.scrollTo({ top: clamped * slideHeight, behavior: "smooth" });
      setActiveIndex(clamped);
    },
    [items.length],
  );

  const advance = useCallback(() => {
    const next = activeIndex + 1;
    if (next < items.length) {
      scrollToIndex(next);
      return;
    }
    loadMore();
  }, [activeIndex, items.length, loadMore, scrollToIndex]);

  const goPrevious = useCallback(() => {
    if (activeIndex > 0) scrollToIndex(activeIndex - 1);
  }, [activeIndex, scrollToIndex]);

  const onShortWatched = useCallback(
    (videoId: string) => {
      const video = items.find((v) => v.videoId === videoId);
      if (video) markShortSeen(video);
    },
    [items, markShortSeen],
  );

  useEffect(() => {
    if (!feed.isSuccess || feed.isFetchingNextPage) return;
    if (items.length > 0 || !feed.hasNextPage) return;
    loadMore();
  }, [
    feed.hasNextPage,
    feed.isFetchingNextPage,
    feed.isSuccess,
    items.length,
    loadMore,
  ]);

  const emptyPageRetriesRef = useRef(0);

  useEffect(() => {
    if (!feed.isSuccess || feed.isFetchingNextPage) return;
    const pages = feed.data?.pages;
    if (!pages?.length) return;
    const lastPage = pages[pages.length - 1];
    if (lastPage.videos.length > 0) {
      emptyPageRetriesRef.current = 0;
      return;
    }
    if (!feed.hasNextPage) return;
    if (emptyPageRetriesRef.current >= 5) return;
    emptyPageRetriesRef.current += 1;
    // After 2 empty pages, switch to recycle mode: the server is recycling
    // content and the items effect must accept it to fill the feed.
    if (emptyPageRetriesRef.current >= 2 && !recycleModeRef.current) {
      recycleModeRef.current = true;
      setRecycleMode(true);
    }
    loadMore();
  }, [
    feed.data,
    feed.hasNextPage,
    feed.isFetchingNextPage,
    feed.isSuccess,
    loadMore,
  ]);

  const fatalError =
    feed.isError && items.length === 0 ? feed.error.message : null;
  const rateLimited = feed.error?.data?.code === "TOO_MANY_REQUESTS";

  if (fatalError) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center text-[hsl(var(--muted-foreground))]">
        <p className="text-sm text-white/90">
          {rateLimited
            ? "Too many requests — wait a moment and retry."
            : "Shorts feed is temporarily unavailable."}
        </p>
        <p className="text-xs">{fatalError}</p>
        <button
          type="button"
          className="text-sm text-[hsl(var(--primary))] hover:underline"
          onClick={() => void feed.refetch()}
        >
          Retry
        </button>
        <Link href="/" className="text-sm text-white/70 hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  if (feed.isLoading && items.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black text-sm text-white/70">
        Loading shorts…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center text-[hsl(var(--muted-foreground))]">
        <p className="text-sm text-white/90">
          {feedWarning ?? "No shorts available right now."}
        </p>
        <ShortsEmptyHint upstream={upstream} signedIn={signedIn} />
        <button
          type="button"
          className="text-sm text-[hsl(var(--primary))] hover:underline"
          onClick={() => void feed.refetch()}
        >
          Retry
        </button>
        <Link href="/" className="text-sm text-white/70 hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-black">
      {/* Exit cross: the only way out on phones, where the topbar and bottom tab
          bar are hidden for the full-screen feed. Shown only there (chrome is
          back at ≥901px). */}
      <button
        type="button"
        aria-label="Close shorts"
        onClick={exitShorts}
        className="absolute right-3 top-[calc(0.5rem+env(safe-area-inset-top))] z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65 min-[901px]:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          className="h-5 w-5"
          aria-hidden
        >
          <title>Close</title>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div className="pointer-events-none absolute inset-y-0 right-3 z-40 hidden flex-col items-center justify-center gap-3 sm:flex">
        <button
          type="button"
          aria-label="Previous short"
          disabled={activeIndex <= 0}
          onClick={goPrevious}
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/25 disabled:opacity-30"
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-6 w-6"
            aria-hidden
          >
            <title>Previous short</title>
            <path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Next short"
          onClick={advance}
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/25"
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-6 w-6"
            aria-hidden
          >
            <title>Next short</title>
            <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
          </svg>
        </button>
      </div>
      <div
        ref={scrollRef}
        className="absolute inset-0 snap-y snap-mandatory overflow-y-auto overscroll-y-contain touch-pan-y [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((video) => (
          <div
            key={video.videoId}
            className="h-full min-h-full w-full shrink-0 snap-start snap-always"
          >
            <ShortsSlide
              video={video}
              active={activeVideoId === video.videoId}
              signedIn={signedIn}
              initialDetail={
                initialDetail?.videoId === video.videoId
                  ? initialDetail
                  : undefined
              }
              onWatched={signedIn ? onShortWatched : undefined}
              onEnded={advance}
            />
          </div>
        ))}
        {feed.isFetchingNextPage ? (
          <div className="flex h-16 shrink-0 snap-start items-center justify-center text-xs text-white/50">
            Loading more…
          </div>
        ) : null}
        {loadMoreError ? (
          <div className="flex h-16 shrink-0 snap-start items-center justify-center px-6 text-center text-xs text-amber-200/90">
            {loadMoreError}
          </div>
        ) : null}
      </div>
      {preloadNext
        ? Array.from({ length: SHORTS_PRELOAD_AHEAD }, (_, i) => {
            const next = items[activeIndex + 1 + i];
            return next ? (
              <ShortsPreloader key={next.videoId} videoId={next.videoId} />
            ) : null;
          })
        : null}
    </div>
  );
}
