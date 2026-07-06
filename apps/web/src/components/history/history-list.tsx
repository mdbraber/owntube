"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LibraryVideoRow } from "@/components/library/library-video-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDuration } from "@/lib/video-display";
import { trpc } from "@/trpc/react";

type HistoryItem = {
  id: number;
  videoId: string;
  channelId: string;
  startedAt: number;
  durationWatched: number;
  videoDurationSeconds: number;
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
  const [hideWatched, setHideWatched] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<HistoryItem[]>(initialItems);
  const appliedQueryRef = useRef("");

  useEffect(() => {
    const t = window.setTimeout(() => {
      const nextQuery = query.trim();
      if (appliedQueryRef.current === nextQuery) return;
      appliedQueryRef.current = nextQuery;
      setDebouncedQuery(nextQuery);
      setPage(1);
      setItems([]);
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const listQuery = trpc.history.list.useQuery(
    {
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQuery || undefined,
      hideWatched,
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

  const toggleHideWatched = (next: boolean) => {
    setHideWatched(next);
    setPage(1);
    setItems([]);
  };

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <input
              type="checkbox"
              checked={hideWatched}
              onChange={(e) => toggleHideWatched(e.currentTarget.checked)}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            Hide watched videos
          </label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search by title or channel"
            className="sm:w-80"
            aria-label="Search history"
          />
        </div>
      </div>

      {items.length === 0 && listQuery.isFetching ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading…</p>
      ) : null}

      {items.length === 0 && !listQuery.isFetching ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          {isSearching
            ? "No matches in history."
            : hideWatched
              ? "No unwatched videos in history."
              : "No history yet."}
        </p>
      ) : null}

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <LibraryVideoRow
              videoId={item.videoId}
              title={item.videoTitle ?? item.videoId}
              channelId={item.channelId}
              channelName={item.channelName}
              thumbnailUrl={item.thumbnailUrl}
              progress={
                item.videoDurationSeconds > 0
                  ? item.durationWatched / item.videoDurationSeconds
                  : undefined
              }
              meta={
                <>
                  <span>
                    Watched: {formatDuration(item.durationWatched) ?? "0:00"}
                    {item.videoDurationSeconds > 0
                      ? ` / ${formatDuration(item.videoDurationSeconds)}`
                      : ""}
                    {item.completed ? " · Completed" : ""}
                  </span>
                  <span className="mt-0.5 block">
                    {new Date(item.startedAt * 1000).toLocaleString()}
                  </span>
                </>
              }
              trailing={
                <Button
                  variant="outline"
                  onClick={() => deleteMutation.mutate({ id: item.id })}
                  disabled={deleteMutation.isPending}
                >
                  Remove
                </Button>
              }
            />
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
