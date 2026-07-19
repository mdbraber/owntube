"use client";

import Link from "next/link";
import { playlistHref } from "@/lib/yt-routes";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChannelListItem } from "@/components/channel/channel-list-item";
import { Button } from "@/components/ui/button";
import { useIgnoredVideos } from "@/components/videos/ignored-videos-context";
import { PlaylistIcon } from "@/components/videos/video-action-icons";
import { VideoGrid } from "@/components/videos/video-grid";
import { mergeVideosNewestFirst } from "@/lib/published-sort-key";
import type { ChannelTab, UnifiedVideo } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

type SuggestedChannel = {
  channelId: string;
  channelName: string;
  channelAvatarUrl?: string;
  description?: string;
  subscriberCount?: number;
};

type SectionTab = ChannelTab | "playlists" | "similar";

type ChannelVideosSectionProps = {
  channelId: string;
  initialTab?: ChannelTab;
  initialVideos: UnifiedVideo[];
  initialContinuation?: string | null;
  sourceUsed: string;
  stale?: boolean;
};

const TABS: { id: SectionTab; label: string }[] = [
  { id: "videos", label: "Videos" },
  { id: "shorts", label: "Shorts" },
  { id: "playlists", label: "Playlists" },
  { id: "similar", label: "Similar" },
];

export function ChannelVideosSection({
  channelId,
  initialTab = "videos",
  initialVideos,
  initialContinuation,
  sourceUsed,
  stale,
}: ChannelVideosSectionProps) {
  const [tab, setTab] = useState<SectionTab>(initialTab);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isVideoTab = tab === "videos" || tab === "shorts";
  const videoTab: ChannelTab = isVideoTab ? tab : "videos";

  const playlistsQuery = trpc.channel.playlists.useQuery(
    { channelId },
    { enabled: tab === "playlists", staleTime: 10 * 60_000 },
  );

  const relatedQuery = trpc.channel.relatedChannels.useQuery(
    { channelId },
    { enabled: tab === "similar", staleTime: 30 * 60_000 },
  );

  const query = trpc.channel.page.useInfiniteQuery(
    { channelId, tab: videoTab },
    {
      enabled: isVideoTab,
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

  const { sessionIgnored } = useIgnoredVideos();
  const ignoredQuery = trpc.interactions.ignoredAmong.useQuery(
    { videoIds: videos.slice(0, 200).map((v) => v.videoId) },
    { enabled: videos.length > 0 },
  );
  const dimVideoIds = useMemo(
    () => new Set([...(ignoredQuery.data ?? []), ...sessionIgnored]),
    [ignoredQuery.data, sessionIgnored],
  );

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

  const onTabChange = (next: SectionTab) => {
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
      </div>

      {tab === "playlists" ? (
        <ChannelPlaylistsGrid
          playlists={playlistsQuery.data?.playlists ?? []}
          isPending={playlistsQuery.isPending}
          isError={playlistsQuery.isError}
        />
      ) : tab === "similar" ? (
        <SimilarChannelsGrid
          channels={relatedQuery.data?.channels ?? []}
          isPending={relatedQuery.isPending}
          isError={relatedQuery.isError}
        />
      ) : (
        <>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {videos.length} result{videos.length === 1 ? "" : "s"}
            {query.hasNextPage ? " · more available" : ""}
          </p>

          {query.isPending && videos.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Loading…
            </p>
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
              dimVideoIds={dimVideoIds}
            />
          ) : !query.isPending && !query.isError ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
              No {tab === "shorts" ? "shorts" : "videos"} found for this
              channel.
            </p>
          ) : null}

          {query.hasNextPage ? (
            <div
              ref={sentinelRef}
              className="h-1 w-full shrink-0"
              aria-hidden
            />
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
        </>
      )}
    </section>
  );
}

/** The channel's public YouTube playlists as collage-free thumbnail cards. */
function ChannelPlaylistsGrid({
  playlists,
  isPending,
  isError,
}: {
  playlists: {
    playlistId: string;
    title: string;
    thumbnailUrl: string | null;
    videoCount: number | null;
  }[];
  isPending: boolean;
  isError: boolean;
}) {
  if (isPending) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading…</p>
    );
  }
  if (isError) {
    return (
      <p className="rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Could not load playlists. Try again later.
      </p>
    );
  }
  if (playlists.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No public playlists on this channel.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {playlists.map((p) => (
        <li key={p.playlistId}>
          <Link
            href={playlistHref(p.playlistId)}
            className="group flex items-center gap-3 rounded-[var(--radius-card)] p-2 transition hover:bg-[hsl(var(--muted)_/_0.45)]"
          >
            <div className="relative aspect-video w-[12.75rem] shrink-0 overflow-hidden rounded-xl bg-[hsl(var(--muted))] sm:w-60">
              {p.thumbnailUrl ? (
                // biome-ignore lint/performance/noImgElement: third-party playlist thumbnail
                <img
                  src={p.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[hsl(var(--muted-foreground))]">
                  <PlaylistIcon className="h-8 w-8" />
                </div>
              )}
              {p.videoCount != null ? (
                <span className="absolute bottom-1 right-1 z-10 rounded-md bg-black/78 px-1.5 py-px font-mono text-[10px] font-semibold text-white">
                  {p.videoCount} {p.videoCount === 1 ? "video" : "videos"}
                </span>
              ) : null}
            </div>
            <p className="m-0 line-clamp-2 min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]">
              {p.title}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Channels related to this one, derived from YouTube's recommendation graph. */
function SimilarChannelsGrid({
  channels,
  isPending,
  isError,
}: {
  channels: SuggestedChannel[];
  isPending: boolean;
  isError: boolean;
}) {
  if (isPending) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading…</p>
    );
  }
  if (isError) {
    return (
      <p className="rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Could not load suggestions. Try again later.
      </p>
    );
  }
  if (channels.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-14 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No similar channels found yet.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-1 lg:grid-cols-2">
      {channels.map((c) => (
        <li key={c.channelId}>
          <ChannelListItem
            channel={{
              channelId: c.channelId,
              channelName: c.channelName,
              avatarUrl: c.channelAvatarUrl,
              description: c.description,
              subscriberCount: c.subscriberCount,
            }}
          />
        </li>
      ))}
    </ul>
  );
}
