"use client";

import { useEffect, useRef } from "react";
import { VideoGrid } from "@/components/videos/video-grid";
import { trpc } from "@/trpc/react";

export function SubscriptionVideosInfinite() {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const refreshTokenRef = useRef<number>(Date.now());
  const query = trpc.subscriptions.mergedFeedInfinite.useInfiniteQuery(
    { limit: 24, refreshToken: refreshTokenRef.current },
    {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      initialCursor: null,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  );
  const queryRef = useRef(query);
  queryRef.current = query;

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
      <p className="rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Could not load subscription videos. Try again later.
      </p>
    );
  }

  const videos = query.data.pages.flatMap((p) => p.videos);

  return (
    <div className="space-y-6">
      <VideoGrid videos={videos} size="large" />
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
