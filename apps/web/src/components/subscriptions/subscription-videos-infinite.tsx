"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SubscriptionTagFilter,
  type TagState,
} from "@/components/subscriptions/subscription-tag-filter";
import { RefreshControl } from "@/components/ui/refresh-control";
import { useIgnoredVideos } from "@/components/videos/ignored-videos-context";
import { VideoGrid } from "@/components/videos/video-grid";
import { normalizeChannelTag } from "@/lib/channel-tag";
import { trpc } from "@/trpc/react";

const TAG_FILTER_STORAGE_KEY = "ot:sub-tag-filter";

function readStoredTagStates(): Record<string, TagState> {
  try {
    const raw = localStorage.getItem(TAG_FILTER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TagState>;
    const out: Record<string, TagState> = {};
    for (const [tag, state] of Object.entries(parsed)) {
      if (state === "include" || state === "exclude") out[tag] = state;
    }
    return out;
  } catch {
    return {};
  }
}

/** Pixels the user must pull past (at the top of the page) to trigger a refresh. */
const PULL_THRESHOLD = 64;
/** Damping so the indicator trails the finger rather than tracking it 1:1. */
const PULL_DAMPING = 0.5;
const PULL_MAX = 96;

export function SubscriptionVideosInfinite() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { sessionIgnored } = useIgnoredVideos();
  const refreshTokenRef = useRef<number>(Date.now());
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();

  // ── Tag filter ──────────────────────────────────────────────────────────────
  const allTagsQuery = trpc.channelTags.listAll.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const [tagStates, setTagStates] = useState<Record<string, TagState>>({});
  const [tagHydrated, setTagHydrated] = useState(false);
  // A `?tag=` link (from a channel page) presets "only this tag"; otherwise
  // restore the persisted filter. Done in an effect to avoid SSR hydration drift.
  useEffect(() => {
    const paramTag = normalizeChannelTag(searchParams.get("tag") ?? "");
    setTagStates(paramTag ? { [paramTag]: "include" } : readStoredTagStates());
    setTagHydrated(true);
  }, [searchParams]);
  useEffect(() => {
    if (!tagHydrated) return;
    try {
      localStorage.setItem(TAG_FILTER_STORAGE_KEY, JSON.stringify(tagStates));
    } catch {
      // ignore storage failures (private mode, quota)
    }
  }, [tagStates, tagHydrated]);

  const includeTags = useMemo(
    () =>
      Object.entries(tagStates)
        .filter(([, s]) => s === "include")
        .map(([t]) => t),
    [tagStates],
  );
  const excludeTags = useMemo(
    () =>
      Object.entries(tagStates)
        .filter(([, s]) => s === "exclude")
        .map(([t]) => t),
    [tagStates],
  );
  const filterActive = includeTags.length > 0 || excludeTags.length > 0;

  const cycleTag = useCallback((tag: string) => {
    setTagStates((prev) => {
      const cur = prev[tag] ?? "off";
      const next: TagState =
        cur === "off" ? "include" : cur === "include" ? "exclude" : "off";
      const copy = { ...prev };
      if (next === "off") delete copy[tag];
      else copy[tag] = next;
      return copy;
    });
  }, []);
  const showAllTags = useCallback(() => setTagStates({}), []);
  const hideAllTags = useCallback(() => {
    const all = allTagsQuery.data ?? [];
    setTagStates(Object.fromEntries(all.map((t) => [t.tag, "exclude"])));
  }, [allTagsQuery.data]);

  const query = trpc.subscriptions.mergedFeedInfinite.useInfiniteQuery(
    {
      limit: 24,
      refreshToken: refreshTokenRef.current,
      includeTags: includeTags.length > 0 ? includeTags : undefined,
      excludeTags: excludeTags.length > 0 ? excludeTags : undefined,
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
    .filter((v) => !sessionIgnored.has(v.videoId));
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SubscriptionTagFilter
          tags={allTagsQuery.data ?? []}
          stateFor={(tag) => tagStates[tag] ?? "off"}
          onCycle={cycleTag}
          onShowAll={showAllTags}
          onHideAll={hideAllTags}
        />
        <div className="ml-auto">
          <RefreshControl
            isRefreshing={isRefreshing}
            onRefresh={doRefresh}
            refreshedAt={refreshedAt}
          />
        </div>
      </div>

      {videos.length === 0 && filterActive ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No videos match the current tag filter.
        </p>
      ) : (
        <VideoGrid videos={videos} size="large" enableSwipe />
      )}
      {query.hasNextPage ? (
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
