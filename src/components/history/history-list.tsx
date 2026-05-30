"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";
import { trpc } from "@/trpc/react";

type HistoryItem = {
  id: number;
  videoId: string;
  channelId: string;
  startedAt: number;
  durationWatched: number;
  completed: number;
  videoTitle?: string;
  thumbnailUrl?: string;
  channelName?: string;
};

type HistoryListProps = {
  initialItems: HistoryItem[];
};

const PAGE_SIZE = 30;

export function HistoryList({ initialItems }: HistoryListProps) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<HistoryItem[]>(initialItems);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
    setItems([]);
  }, [debouncedQuery]);

  const listQuery = trpc.history.list.useQuery(
    {
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQuery || undefined,
    },
    {
      placeholderData: (prev) => prev,
    },
  );

  useEffect(() => {
    if (!listQuery.data) return;
    setItems((prev) => {
      if (page === 1) return listQuery.data;
      const seen = new Set(prev.map((x) => x.id));
      return [...prev, ...listQuery.data.filter((x) => !seen.has(x.id))];
    });
  }, [listQuery.data, page]);

  const deleteMutation = trpc.history.softDelete.useMutation({
    onSuccess: async (_, vars) => {
      setItems((prev) => prev.filter((item) => item.id !== vars.id));
      await utils.history.list.invalidate();
    },
  });

  const hasMore = (listQuery.data?.length ?? 0) >= PAGE_SIZE;
  const isSearching = debouncedQuery.length > 0;
  const title = useMemo(() => {
    if (!isSearching) return "Your history";
    return `Results for "${debouncedQuery}"`;
  }, [debouncedQuery, isSearching]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <Input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search by video ID or channel ID"
          className="sm:w-80"
          aria-label="Search history"
        />
      </div>

      {items.length === 0 && listQuery.isFetching ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading…</p>
      ) : null}

      {items.length === 0 && !listQuery.isFetching ? (
        <p className="rounded-[14px] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          {isSearching ? "No matches in history." : "No history yet."}
        </p>
      ) : null}

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border p-3">
            <div className="flex items-start gap-3">
              <Link
                href={`/watch/${encodeURIComponent(item.videoId)}`}
                className="block shrink-0"
              >
                <div className="relative aspect-video w-44 overflow-hidden rounded-lg bg-[hsl(var(--muted))]">
                  {item.thumbnailUrl ? (
                    <VideoThumbnailImg
                      url={item.thumbnailUrl}
                      videoId={item.videoId}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : null}
                </div>
              </Link>
              <div className="min-w-0 flex-1 space-y-1">
                <Link
                  href={`/watch/${encodeURIComponent(item.videoId)}`}
                  className="line-clamp-2 font-medium hover:underline"
                >
                  {item.videoTitle ?? item.videoId}
                </Link>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  <Link
                    href={`/channel/${encodeURIComponent(item.channelId)}`}
                    className="hover:underline"
                  >
                    {item.channelName ?? item.channelId}
                  </Link>
                  {" · "}Watched: {item.durationWatched}s
                  {item.completed ? " · Completed" : ""}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {new Date(item.startedAt * 1000).toLocaleString()}
                </p>
              </div>
              <div className="shrink-0">
                <Button
                  variant="outline"
                  onClick={() => deleteMutation.mutate({ id: item.id })}
                  disabled={deleteMutation.isPending}
                >
                  Remove
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {hasMore ? (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => setPage((p) => p + 1)}
            disabled={listQuery.isFetching}
          >
            {listQuery.isFetching ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
