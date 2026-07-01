"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { VideoGrid } from "@/components/videos/video-grid";
import { mergeVideosNewestFirst } from "@/lib/published-sort-key";
import type { ChannelTab, UnifiedVideo } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

type ChannelVideosSectionProps = {
  channelId: string;
  initialTab?: ChannelTab;
  initialVideos: UnifiedVideo[];
  initialContinuation?: string | null;
  sourceUsed: string;
  stale?: boolean;
};

const TABS: { id: ChannelTab; label: string }[] = [
  { id: "videos", label: "Videos" },
  { id: "shorts", label: "Shorts" },
];

export function ChannelVideosSection({
  channelId,
  initialTab = "videos",
  initialVideos,
  initialContinuation,
  sourceUsed,
  stale,
}: ChannelVideosSectionProps) {
  const [tab, setTab] = useState<ChannelTab>(initialTab);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = trpc.channel.page.useInfiniteQuery(
    { channelId, tab },
    {
      getNextPageParam: (last) => last.continuation ?? undefined,
      initialData:
        tab === initialTab
          ? {
              pages: [
                {
                  channelId,
                  videos: initialVideos,
                  continuation: initialContinuation ?? null,
                  sourceUsed: sourceUsed as "piped" | "invidious" | "cache",
                  stale,
                },
              ],
              pageParams: [undefined],
            }
          : undefined,
      refetchOnMount: tab !== initialTab,
    },
  );

  const videos = useMemo(
    () => mergeVideosNewestFirst(query.data?.pages.map((p) => p.videos) ?? []),
    [query.data?.pages],
  );

  const lastPage = query.data?.pages.at(-1);
  const activeSource = lastPage?.sourceUsed ?? sourceUsed;
  const activeStale = lastPage?.stale ?? stale;

  useEffect(() => {
    if (!query.hasNextPage) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (!query.hasNextPage || query.isFetchingNextPage) return;
        void query.fetchNextPage();
      },
      { root: null, rootMargin: "480px 0px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [query]);

  const onTabChange = (next: ChannelTab) => {
    if (next === tab) return;
    setTab(next);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[hsl(var(--border))]">
        <div className="flex gap-1" role="tablist" aria-label="Channel content">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={
                  active
                    ? "border-b-2 border-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))]"
                    : "px-4 py-2.5 text-sm font-medium text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
                }
                onClick={() => onTabChange(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <p className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 font-mono text-xs text-[hsl(var(--muted-foreground))]">
          {activeSource}
          {activeStale ? " · stale cache" : ""}
        </p>
      </div>

      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        {videos.length} result{videos.length === 1 ? "" : "s"}
        {query.hasNextPage ? " · more available" : ""}
      </p>

      {query.isPending && videos.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading…</p>
      ) : null}

      {query.isError && videos.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Could not load {tab === "shorts" ? "shorts" : "videos"}. Try again
          later.
        </p>
      ) : null}

      {videos.length > 0 ? (
        <VideoGrid
          videos={videos}
          size="large"
          variant={tab === "shorts" ? "short" : "video"}
        />
      ) : !query.isPending && !query.isError ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No {tab === "shorts" ? "shorts" : "videos"} found for this channel.
        </p>
      ) : null}

      {query.hasNextPage ? (
        <div ref={sentinelRef} className="h-1 w-full shrink-0" aria-hidden />
      ) : null}

      {query.isFetchingNextPage ? (
        <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
          Loading more…
        </p>
      ) : null}

      {query.hasNextPage && !query.isFetchingNextPage ? (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </section>
  );
}
