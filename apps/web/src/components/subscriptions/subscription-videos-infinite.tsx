"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FeedPagePrefs,
  type FeedSection,
  useFeedPagePrefs,
} from "@/components/library/section-options-menu";
import { RefreshControl } from "@/components/ui/refresh-control";
import { useIgnoredVideos } from "@/components/videos/ignored-videos-context";
import { VideoGrid } from "@/components/videos/video-grid";
import { useWatchProgressMap } from "@/components/videos/video-membership-context";
import { VideoRow } from "@/components/videos/video-row";
import { useAutoFillColumns } from "@/hooks/use-auto-fill-columns";
import { CARD_MIN_WIDTH_PX } from "@/lib/home-blocks";
import { formatPublishedLabel } from "@/lib/video-display";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

/** Pixels the user must pull past (at the top of the page) to trigger a refresh. */
const PULL_THRESHOLD = 64;
/** Damping so the indicator trails the finger rather than tracking it 1:1. */
const PULL_DAMPING = 0.5;
const PULL_MAX = 96;

type SubscriptionVideosInfiniteProps = {
  /** Shared tag filter, owned by SubscriptionsTabs. */
  includeTags: string[];
  excludeTags: string[];
  /** "all": channels need every included tag (tag pages). */
  tagMatch?: "any" | "all";
  /** Only favorite channels (the Favorites page). */
  favorites?: boolean;
  /** Whose ⋯ options (layout, size, rows, filters) apply. */
  section?: FeedSection;
};

export function SubscriptionVideosInfinite({
  includeTags,
  excludeTags,
  tagMatch,
  favorites,
  section = "subscriptions",
}: SubscriptionVideosInfiniteProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { sessionIgnored } = useIgnoredVideos();
  // The page's ⋯ menu options (Subscriptions' are shared with By tag).
  const prefs = useFeedPagePrefs(section);
  const { hideCompleted, hideIgnored } = prefs;
  const progressMap = useWatchProgressMap();
  // Starts at 0 (not Date.now()) so the first query key is stable and matches
  // the server's SSR prefetch → the feed hydrates instead of flashing a
  // skeleton. A manual pull-to-refresh bumps it to Date.now() to force a
  // refetch. Keep in sync with the prefetch in app/subscriptions/page.tsx.
  const refreshTokenRef = useRef<number>(0);
  const utils = trpc.useUtils();
  const filterActive =
    includeTags.length > 0 || excludeTags.length > 0 || favorites === true;

  const query = trpc.subscriptions.mergedFeedInfinite.useInfiniteQuery(
    {
      limit: 24,
      refreshToken: refreshTokenRef.current,
      includeTags: includeTags.length > 0 ? includeTags : undefined,
      excludeTags: excludeTags.length > 0 ? excludeTags : undefined,
      // Only set when used, so the Subscriptions page's key still matches
      // its SSR prefetch.
      ...(tagMatch === "all" ? { tagMatch } : {}),
      ...(favorites ? { favorites } : {}),
      // Page overrides of the server defaults (profile Shorts setting, ignored
      // videos dropped) — likewise only sent when set.
      ...(prefs.hideShortsSet ? { hideShorts: prefs.hideShorts } : {}),
      ...(hideIgnored ? {} : { hideIgnored: false }),
    },
    {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      initialCursor: null,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Keep the current results on screen while a tag-filter change refetches,
      // instead of blanking to the pending state (which reads like a reload).
      placeholderData: (prev) => prev,
    },
  );
  const queryRef = useRef(query);
  queryRef.current = query;

  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const refreshMutation = trpc.subscriptions.refreshFeed.useMutation({
    onSuccess: (res) => {
      setRefreshedAt(res.refreshedAt);
    },
    // Whether the live warm succeeds or partially times out, refetch so the feed
    // shows whatever landed in the (now warmer) cache.
    onSettled: async () => {
      refreshTokenRef.current = Date.now();
      await utils.subscriptions.mergedFeedInfinite.invalidate();
    },
  });

  const isRefreshing = refreshMutation.isPending;
  const doRefresh = useCallback(() => {
    if (refreshMutation.isPending) return;
    refreshMutation.mutate();
  }, [refreshMutation]);

  // ── Pull-to-refresh (touch) ────────────────────────────────────────────────
  const [pull, setPull] = useState(0);
  const pullStartY = useRef<number | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isRefreshing) return;
      pullStartY.current =
        window.scrollY <= 0 ? (e.touches[0]?.clientY ?? null) : null;
    },
    [isRefreshing],
  );
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (pullStartY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - pullStartY.current;
    setPull(dy > 0 ? Math.min(dy * PULL_DAMPING, PULL_MAX) : 0);
  }, []);
  const onTouchEnd = useCallback(() => {
    if (pullStartY.current !== null && pull >= PULL_THRESHOLD) doRefresh();
    pullStartY.current = null;
    setPull(0);
  }, [pull, doRefresh]);

  useEffect(() => {
    if (!query.hasNextPage) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const q = queryRef.current;
        if (!q.hasNextPage || q.isFetchingNextPage) return;
        void q.fetchNextPage();
      },
      { root: null, rootMargin: "480px 0px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [query.hasNextPage]);

  if (query.isPending) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Loading videos…
      </p>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <RefreshControl
            isRefreshing={isRefreshing}
            onRefresh={doRefresh}
            refreshedAt={refreshedAt}
          />
        </div>
        <p className="rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Could not load subscription videos. Try again later.
        </p>
      </div>
    );
  }

  const videos = query.data.pages
    .flatMap((p) => p.videos)
    .filter((v) => !hideIgnored || !sessionIgnored.has(v.videoId))
    .filter((v) => {
      if (!hideCompleted) return true;
      const p = progressMap.get(v.videoId);
      // As Home's blocks: near-finished (≥90%) counts as watched.
      return !p || (!p.completed && p.fraction < 0.9);
    });
  // Only reflect the pull gesture here; the RefreshControl button owns the
  // refreshing spinner/label, so there's no duplicate indicator during a refresh.
  const pullActive = pull > 0 && !isRefreshing;

  return (
    <div
      className="space-y-6"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* Pull-to-refresh hint (touch only); collapses to 0 height when idle. */}
      <div
        aria-hidden={!pullActive}
        className="flex items-center justify-center overflow-hidden text-xs text-[hsl(var(--muted-foreground))] transition-[height] duration-150"
        style={{ height: pullActive ? pull : 0 }}
      >
        {pullActive ? (
          <span className="flex items-center gap-2">
            <Spinner spinning={pull >= PULL_THRESHOLD} />
            {pull >= PULL_THRESHOLD ? "Release to refresh" : "Pull to refresh"}
          </span>
        ) : null}
      </div>

      <div className="flex justify-end">
        <RefreshControl
          isRefreshing={isRefreshing}
          onRefresh={doRefresh}
          refreshedAt={refreshedAt}
        />
      </div>

      {videos.length === 0 && (filterActive || hideCompleted) ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          {filterActive
            ? "No videos match the current tag filter."
            : "No unwatched videos here yet."}
        </p>
      ) : (
        <FeedVideos
          videos={videos}
          prefs={prefs}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={query.fetchNextPage}
        />
      )}
      {query.hasNextPage && prefs.rows === 0 ? (
        <div ref={sentinelRef} className="h-1 w-full shrink-0" aria-hidden />
      ) : null}
      {query.isFetchingNextPage ? (
        <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
          Loading more…
        </p>
      ) : null}
    </div>
  );
}

/**
 * The feed as cards or rows at the page's size, like a home block. With a row
 * cap it shows exactly that many (full card rows at the measured column
 * count), fetching pages until they're filled; uncapped, the caller's
 * sentinel keeps scrolling. A single column (phones) always renders cards.
 */
function FeedVideos({
  videos,
  prefs,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  videos: UnifiedVideo[];
  prefs: FeedPagePrefs;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Stable (React Query binds it), so the fill effect runs on change only. */
  fetchNextPage: () => unknown;
}) {
  const minColumnWidthPx = CARD_MIN_WIDTH_PX[prefs.rowSize];
  const grid = useAutoFillColumns(minColumnWidthPx);
  const singleColumn = grid.columns <= 1;
  const layout = singleColumn ? "cards" : prefs.layout;
  const cap =
    prefs.rows === 0
      ? null
      : layout === "cards"
        ? grid.columns * prefs.rows
        : prefs.rows;
  const short = cap !== null && videos.length < cap;
  useEffect(() => {
    if (short && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [short, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const shown = cap === null ? videos : videos.slice(0, cap);

  return (
    <div ref={grid.ref}>
      {layout === "cards" ? (
        <VideoGrid
          videos={shown}
          size="large"
          minColumnWidthPx={minColumnWidthPx}
          enableSwipe
        />
      ) : (
        <ul className="space-y-1">
          {shown.map((v) => (
            <li key={v.videoId}>
              <VideoRow
                videoId={v.videoId}
                title={v.title}
                channelId={v.channelId}
                channelName={v.channelName}
                thumbnailUrl={v.thumbnailUrl}
                durationSeconds={v.durationSeconds}
                meta={
                  formatPublishedLabel(v.publishedText, v.publishedAt) ??
                  undefined
                }
                surface="subscriptions"
                size={prefs.rowSize}
                enableSwipe
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Spinner({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`h-3.5 w-3.5${spinning ? " animate-spin" : ""}`}
      aria-hidden
    >
      <title>Refreshing</title>
      <path
        d="M21 12a9 9 0 1 1-6.219-8.56"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
