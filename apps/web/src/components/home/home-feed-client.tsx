"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { HomeHero } from "@/components/home/home-hero";
import { HomeShortsShelf } from "@/components/home/home-shorts-shelf";
import { Button } from "@/components/ui/button";
import { useIgnoredVideos } from "@/components/videos/ignored-videos-context";
import { VideoGrid } from "@/components/videos/video-grid";
import { useLargeVideoGridColumnCount } from "@/hooks/use-large-video-grid-column-count";
import {
  computeHomeShortsShelfLayout,
  LARGE_VIDEO_GRID_COLUMN_GAP_PX,
} from "@/lib/video-grid-columns";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

const PAGE_SIZE = 24;
/** Personalized pool (~15) + trending tail (~9) — hard stop for runaway fetches. */
const MAX_FEED_PAGES = 32;
const LOAD_MORE_SKELETON_COUNT = 9;
const LOAD_MORE_SKELETON_KEYS = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
] as const;
const SHORTS_SKELETON_SLOT_KEYS = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
] as const;

type HomeFeedClientProps = {
  region: string;
  isAuthed: boolean;
};

function dedupeVideos(videos: UnifiedVideo[]): UnifiedVideo[] {
  const seen = new Set<string>();
  const out: UnifiedVideo[] = [];
  for (const v of videos) {
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    out.push(v);
  }
  return out;
}

function HomeShortsShelfSkeletonInline({
  slots,
  shortWidthPx,
}: {
  slots: number;
  shortWidthPx: number;
}) {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-7 w-24 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
      <ul
        className="flex w-full list-none flex-nowrap"
        style={{ gap: LARGE_VIDEO_GRID_COLUMN_GAP_PX }}
      >
        {SHORTS_SKELETON_SLOT_KEYS.slice(0, Math.max(1, slots)).map((k) => (
          <li
            key={`initial-shorts-skeleton-${k}`}
            className="shrink-0"
            style={{ width: shortWidthPx }}
          >
            <div className="aspect-[9/16] w-full animate-pulse rounded-xl bg-[hsl(var(--muted)_/_0.45)]" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeFeedClient({ region, isAuthed }: HomeFeedClientProps) {
  const { measureRef, columnCount, columnWidthPx, containerWidthPx } =
    useLargeVideoGridColumnCount();
  const { sessionIgnored } = useIgnoredVideos();
  const shortsShelfLayout = useMemo(
    () =>
      computeHomeShortsShelfLayout(
        columnCount,
        columnWidthPx,
        containerWidthPx,
      ),
    [columnCount, columnWidthPx, containerWidthPx],
  );
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const sentinelWasVisibleRef = useRef(false);
  const queryRef = useRef<ReturnType<
    typeof trpc.feed.home.useInfiniteQuery
  > | null>(null);

  const feed = trpc.feed.home.useInfiniteQuery(
    { region, pageSize: PAGE_SIZE },
    {
      initialCursor: 0,
      getNextPageParam: (lastPage, allPages) => {
        if (!lastPage.hasMore || lastPage.videos.length === 0) {
          return undefined;
        }
        if (allPages.length >= MAX_FEED_PAGES) return undefined;
        // Advance by the count the server actually served, not by unique
        // videos shown: the 90s pool/tail caches can reorder between pages,
        // so a page may overlap previous ones. Overlap is deduped at render;
        // stopping on it would dead-end the scroll early.
        return allPages.reduce((n, p) => n + p.videos.length, 0);
      },
      placeholderData: (prev) => prev,
    },
  );
  queryRef.current = feed;

  const merged = useMemo(
    () => dedupeVideos(feed.data?.pages.flatMap((p) => p.videos) ?? []),
    [feed.data?.pages],
  );

  const lastPage = feed.data?.pages[feed.data.pages.length - 1];

  const tryLoadMore = useCallback(() => {
    const q = queryRef.current;
    if (
      !q?.hasNextPage ||
      q.isFetchingNextPage ||
      loadMoreInFlightRef.current
    ) {
      return;
    }
    loadMoreInFlightRef.current = true;
    void q.fetchNextPage().finally(() => {
      loadMoreInFlightRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (!feed.hasNextPage) return;
    const el = sentinelRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? false;
        const wasVisible = sentinelWasVisibleRef.current;
        sentinelWasVisibleRef.current = visible;
        if (visible && !wasVisible) tryLoadMore();
      },
      { root: null, rootMargin: "320px 0px", threshold: 0 },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      sentinelWasVisibleRef.current = false;
    };
  }, [feed.hasNextPage, tryLoadMore]);

  const subtitle = useMemo(() => {
    if (!lastPage) return "";
    if (lastPage.kind === "personalized") {
      return lastPage.coldStart
        ? "Personalized feed — we are still learning what you like."
        : "Based on the channels you watched recently (trending only fills a small share).";
    }
    const cat = lastPage.category;
    const catLabel = cat ?? "general";
    return `Trending ${lastPage.region} · ${catLabel}. ${
      isAuthed
        ? 'The "For You" tab contains recommendations.'
        : "Sign in for a personalized feed."
    }`;
  }, [lastPage, isAuthed]);

  const [first, ...gridVideos] = merged;
  const isInitialLoading = feed.isPending && merged.length === 0;
  const isLoadingMore = feed.isFetchingNextPage;

  const excludeVideoIds = useMemo(() => merged.map((v) => v.videoId), [merged]);
  const topCount = Math.min(gridVideos.length, 2 * columnCount);
  const topVideos = gridVideos.slice(0, topCount);
  const bottomVideos = gridVideos.slice(topCount);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {subtitle || "Preparing your feed…"}
        </p>
      </div>

      {isInitialLoading ? (
        <div className="space-y-6" aria-hidden>
          <div className="relative mb-2 aspect-[21/8] max-h-[min(52vw,420px)] min-h-[200px] w-full overflow-hidden rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] max-sm:aspect-[4/3] max-sm:max-h-none">
            <div className="absolute inset-0 animate-pulse bg-[hsl(var(--muted)_/_0.5)]" />
            <div className="absolute inset-x-0 bottom-0 space-y-3 p-6 sm:px-9 sm:pb-8">
              <div className="h-4 w-36 animate-pulse rounded-full bg-white/20" />
              <div className="h-7 w-4/5 animate-pulse rounded bg-white/20" />
              <div className="h-7 w-2/3 animate-pulse rounded bg-white/15" />
            </div>
          </div>
          <ul className="ot-video-grid ot-video-grid--large">
            {LOAD_MORE_SKELETON_KEYS.slice(0, 4).map((k) => (
              <li key={`initial-skeleton-top-${k}`} className="space-y-3">
                <div className="aspect-video w-full animate-pulse rounded-[var(--radius-card)] bg-[hsl(var(--muted)_/_0.45)]" />
                <div className="flex gap-3">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[hsl(var(--muted)_/_0.45)]" />
                  <div className="min-w-0 flex-1 space-y-2 pt-1">
                    <div className="h-3.5 w-11/12 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
                    <div className="h-3.5 w-4/6 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <HomeShortsShelfSkeletonInline
            slots={shortsShelfLayout.displayCount}
            shortWidthPx={shortsShelfLayout.shortWidthPx}
          />
          <ul className="ot-video-grid ot-video-grid--large">
            {LOAD_MORE_SKELETON_KEYS.slice(4, 6).map((k) => (
              <li key={`initial-skeleton-bottom-${k}`} className="space-y-3">
                <div className="aspect-video w-full animate-pulse rounded-[var(--radius-card)] bg-[hsl(var(--muted)_/_0.45)]" />
                <div className="flex gap-3">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[hsl(var(--muted)_/_0.45)]" />
                  <div className="min-w-0 flex-1 space-y-2 pt-1">
                    <div className="h-3.5 w-11/12 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
                    <div className="h-3.5 w-4/6 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {feed.isError ? (
        <div className="ot-surface-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-[hsl(var(--destructive))]">
            {feed.error.message || "Could not load the feed."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void feed.refetch()}
            disabled={feed.isFetching}
          >
            {feed.isFetching ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : null}

      {first ? <HomeHero video={first} /> : null}

      {gridVideos.length > 0 ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="text-xl font-bold tracking-tight">
              {lastPage?.kind === "personalized" ? "For You" : "Trending"}
            </h2>
            <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
              {merged.length} video{merged.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-6">
            <ul
              ref={measureRef}
              aria-hidden
              className="ot-video-grid ot-video-grid--large pointer-events-none invisible m-0 h-0 p-0"
            />
            {topVideos.length > 0 ? (
              <VideoGrid
                videos={topVideos.filter((v) => !sessionIgnored.has(v.videoId))}
                size="large"
                enableSwipe
              />
            ) : null}
            <HomeShortsShelf
              region={region}
              columnCount={columnCount}
              columnWidthPx={columnWidthPx}
              containerWidthPx={containerWidthPx}
              excludeVideoIds={excludeVideoIds}
            />
            {bottomVideos.length > 0 ? (
              <VideoGrid
                videos={bottomVideos.filter(
                  (v) => !sessionIgnored.has(v.videoId),
                )}
                size="large"
                enableSwipe
              />
            ) : null}
          </div>
        </>
      ) : first ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Scroll to load more rows.
        </p>
      ) : !isInitialLoading ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No videos for now.
        </p>
      ) : null}

      {feed.hasNextPage ? (
        <div ref={sentinelRef} className="h-4 w-full shrink-0" aria-hidden />
      ) : null}

      {isLoadingMore ? (
        <ul className="ot-video-grid ot-video-grid--large" aria-hidden>
          {LOAD_MORE_SKELETON_KEYS.slice(0, LOAD_MORE_SKELETON_COUNT).map(
            (k) => (
              <li key={`skeleton-${k}`} className="space-y-3">
                <div className="aspect-video w-full animate-pulse rounded-[var(--radius-card)] bg-[hsl(var(--muted)_/_0.45)]" />
                <div className="flex gap-3">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[hsl(var(--muted)_/_0.45)]" />
                  <div className="min-w-0 flex-1 space-y-2 pt-1">
                    <div className="h-3.5 w-11/12 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
                    <div className="h-3.5 w-4/6 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {isLoadingMore ? (
        <p className="text-center text-xs text-[hsl(var(--muted-foreground))]">
          Loading more…
        </p>
      ) : null}
    </section>
  );
}
