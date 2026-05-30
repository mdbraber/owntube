"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { VideoCardShort } from "@/components/videos/video-card";
import { readSeenShortIds } from "@/lib/shorts-seen-storage";
import {
  computeHomeShortsShelfLayout,
  LARGE_VIDEO_GRID_COLUMN_GAP_PX,
} from "@/lib/video-grid-columns";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

const SHORTS_SHELF_FETCH_LIMIT = 14;
const SHORTS_SHELF_STALE_MS = 5 * 60_000;
const SKELETON_SLOT_KEYS = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
] as const;

type HomeShortsShelfProps = {
  region: string;
  columnCount: number;
  columnWidthPx: number;
  containerWidthPx: number;
  excludeVideoIds?: readonly string[];
};

function shortCardProps(v: UnifiedVideo) {
  return {
    href: `/shorts?v=${encodeURIComponent(v.videoId)}`,
    videoId: v.videoId,
    title: v.title,
    channelId: v.channelId,
    channelName: v.channelName,
    channelHref: v.channelId
      ? `/channel/${encodeURIComponent(v.channelId)}`
      : undefined,
    thumbnailUrl: v.thumbnailUrl,
    durationSeconds: v.durationSeconds,
    viewCount: v.viewCount,
    publishedText: v.publishedText,
    publishedAt: v.publishedAt,
    layout: "shelf" as const,
  };
}

function HomeShortsShelfRow({ children }: { children: ReactNode }) {
  return (
    <ul
      className="flex w-full list-none flex-nowrap"
      style={{ gap: LARGE_VIDEO_GRID_COLUMN_GAP_PX }}
    >
      {children}
    </ul>
  );
}

function HomeShortsShelfSkeleton({
  slots,
  shortWidthPx,
}: {
  slots: number;
  shortWidthPx: number;
}) {
  return (
    <HomeShortsShelfRow>
      {SKELETON_SLOT_KEYS.slice(0, slots).map((k) => (
        <li
          key={`shorts-skeleton-${k}`}
          className="shrink-0"
          style={{ width: shortWidthPx }}
        >
          <div className="aspect-[9/16] w-full animate-pulse rounded-xl bg-[hsl(var(--muted)_/_0.45)]" />
          <div className="mt-2 h-3.5 w-4/5 animate-pulse rounded bg-[hsl(var(--muted)_/_0.45)]" />
        </li>
      ))}
    </HomeShortsShelfRow>
  );
}

export function HomeShortsShelf({
  region,
  columnCount,
  columnWidthPx,
  containerWidthPx,
  excludeVideoIds = [],
}: HomeShortsShelfProps) {
  const { displayCount, shortWidthPx } = useMemo(
    () =>
      computeHomeShortsShelfLayout(
        columnCount,
        columnWidthPx,
        containerWidthPx,
      ),
    [columnCount, columnWidthPx, containerWidthPx],
  );
  const [seenShortIds, setSeenShortIds] = useState<readonly string[]>([]);
  const [seenHydrated, setSeenHydrated] = useState(false);
  useEffect(() => {
    setSeenShortIds(readSeenShortIds());
    setSeenHydrated(true);
  }, []);

  const excludeSet = useMemo(
    () => new Set([...excludeVideoIds, ...seenShortIds]),
    [excludeVideoIds, seenShortIds],
  );

  const serverExcludeVideoIds = useMemo(() => {
    const merged = [...excludeVideoIds, ...seenShortIds];
    return merged.length > 200 ? merged.slice(-200) : merged;
  }, [excludeVideoIds, seenShortIds]);

  const shortsQuery = trpc.shorts.feed.useQuery(
    {
      region,
      limit: SHORTS_SHELF_FETCH_LIMIT,
      purpose: "shelf",
      excludeVideoIds:
        serverExcludeVideoIds.length > 0 ? serverExcludeVideoIds : undefined,
    },
    {
      enabled: seenHydrated,
      staleTime: SHORTS_SHELF_STALE_MS,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      retry: (failureCount, error) => {
        if (error.data?.code === "TOO_MANY_REQUESTS") return false;
        return failureCount < 1;
      },
    },
  );

  const videos = useMemo(() => {
    const raw = shortsQuery.data?.videos ?? [];
    return raw.filter((v) => !excludeSet.has(v.videoId)).slice(0, displayCount);
  }, [shortsQuery.data?.videos, excludeSet, displayCount]);

  if (shortsQuery.isPending) {
    return (
      <section className="space-y-4" aria-busy="true" aria-label="Shorts">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-xl font-bold tracking-tight">Shorts</h2>
        </div>
        <HomeShortsShelfSkeleton
          slots={displayCount}
          shortWidthPx={shortWidthPx}
        />
      </section>
    );
  }

  if (shortsQuery.isError || videos.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4" aria-label="Shorts">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="text-xl font-bold tracking-tight">Shorts</h2>
        <Link
          href="/shorts"
          className="text-sm font-medium text-[hsl(var(--primary))] underline-offset-4 hover:underline"
        >
          See all
        </Link>
      </div>
      <HomeShortsShelfRow>
        {videos.map((v) => (
          <li
            key={v.videoId}
            className="min-w-0 shrink-0"
            style={{ width: shortWidthPx }}
          >
            <VideoCardShort {...shortCardProps(v)} />
          </li>
        ))}
      </HomeShortsShelfRow>
    </section>
  );
}
