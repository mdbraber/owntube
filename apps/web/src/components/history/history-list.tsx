"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SectionOptionsMenu,
  useSectionPagePrefs,
} from "@/components/library/section-options-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VideoRow } from "@/components/videos/video-row";
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

/** "Today" / "Yesterday" / a readable date — history rows group by day. */
function dayLabel(startedAt: number): string {
  const d = new Date(startedAt * 1000);
  const startOfDay = new Date(d);
  startOfDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (today.getTime() - startOfDay.getTime()) / 86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function HistoryList({ initialItems }: HistoryListProps) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  // Page prefs come from the shared sectionPrefs base (the ⋯ menu writes
  // them); the query below reacts to changes directly.
  const prefs = useSectionPagePrefs("history");
  const hideWatched = prefs.hideCompleted;
  // Back to page 1 whenever the filter flips (accumulated pages differ).
  const prevHideWatched = useRef(hideWatched);
  useEffect(() => {
    if (prevHideWatched.current === hideWatched) return;
    prevHideWatched.current = hideWatched;
    setPage(1);
  }, [hideWatched]);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<HistoryItem[]>(initialItems);
  const appliedQueryRef = useRef("");

  useEffect(() => {
    const t = window.setTimeout(() => {
      const nextQuery = query.trim();
      if (appliedQueryRef.current === nextQuery) return;
      appliedQueryRef.current = nextQuery;
      setDebouncedQuery(nextQuery);
      // Keep current rows while the filtered fetch runs (placeholderData) —
      // clearing here made the whole list flash empty and back.
      setPage(1);
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
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search by title or channel"
            className="sm:w-80"
            aria-label="Search history"
          />
          <SectionOptionsMenu section="history" />
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

      <ul className="space-y-1">
        {items.map((item, i) => {
          const label = dayLabel(item.startedAt);
          const prev = items[i - 1];
          const showHeader = !prev || dayLabel(prev.startedAt) !== label;
          return (
            <li key={item.id}>
              {showHeader ? (
                <p className="px-2 pb-1.5 pt-4 font-mono text-[11px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] first:pt-0">
                  {label}
                </p>
              ) : null}
              <VideoRow
                videoId={item.videoId}
                title={item.videoTitle ?? item.videoId}
                channelId={item.channelId}
                channelName={item.channelName}
                thumbnailUrl={item.thumbnailUrl}
                durationSeconds={
                  item.videoDurationSeconds > 0
                    ? item.videoDurationSeconds
                    : undefined
                }
                surface="history"
                size={prefs.rowSize}
                meta={
                  item.completed
                    ? "Watched"
                    : `${formatDuration(item.durationWatched) ?? "0:00"} watched`
                }
                removeLabel="Remove from history"
                removeDisabled={deleteMutation.isPending}
                onRemove={() => deleteMutation.mutate({ id: item.id })}
              />
            </li>
          );
        })}
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
