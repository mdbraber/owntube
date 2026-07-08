"use client";

import { useEffect, useState } from "react";
import {
  SectionOptionsMenu,
  useSectionPagePrefs,
} from "@/components/library/section-options-menu";
import {
  type DraggableRowItem,
  DraggableVideoRows,
} from "@/components/videos/draggable-video-rows";
import { useWatchProgressMap } from "@/components/videos/video-membership-context";
import { trpc } from "@/trpc/react";

type Item = DraggableRowItem & { position: number };

export function QueuePageClient() {
  const utils = trpc.useUtils();
  const listQuery = trpc.queue.listDetailed.useQuery();
  const invalidateAll = () => {
    utils.queue.listDetailed.invalidate();
    utils.queue.list.invalidate();
  };
  const reorder = trpc.queue.reorder.useMutation({ onSettled: invalidateAll });
  const remove = trpc.queue.remove.useMutation({ onSettled: invalidateAll });
  const clear = trpc.queue.clear.useMutation({ onSettled: invalidateAll });

  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    if (listQuery.data) setItems(listQuery.data as Item[]);
  }, [listQuery.data]);

  const prefs = useSectionPagePrefs("queue");
  const progressMap = useWatchProgressMap();
  const visibleItems = prefs.hideCompleted
    ? items.filter((item) => {
        const p = progressMap.get(item.videoId);
        // YouTube-style: near-finished (≥90%) counts as watched.
        return !p || (!p.completed && p.fraction < 0.9);
      })
    : items;

  if (!listQuery.isLoading && items.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Your queue is empty. Press <strong>Queue</strong> on any video to add it
        here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {items.length > 1 ? (
          <button
            type="button"
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            onClick={() => {
              setItems([]);
              clear.mutate();
            }}
          >
            Clear queue
          </button>
        ) : null}
        <SectionOptionsMenu section="queue" />
      </div>
      <DraggableVideoRows
        items={visibleItems}
        surface="queue"
        removeLabel="Remove from queue"
        removeDisabled={remove.isPending}
        size={prefs.rowSize}
        onMove={(from, to) => {
          // Drag indices are into the *visible* (possibly filtered) list —
          // translate to positions in the full queue via video ids.
          const fromId = visibleItems[from]?.videoId;
          const toId = visibleItems[to]?.videoId;
          if (!fromId || !toId) return;
          setItems((arr) => {
            const fromIdx = arr.findIndex((x) => x.videoId === fromId);
            const toIdx = arr.findIndex((x) => x.videoId === toId);
            if (fromIdx < 0 || toIdx < 0) return arr;
            const next = [...arr];
            const [m] = next.splice(fromIdx, 1);
            next.splice(toIdx, 0, m);
            return next;
          });
        }}
        onDrop={() => {
          setItems((current) => {
            reorder.mutate({ videoIds: current.map((i) => i.videoId) });
            return current;
          });
        }}
        onRemove={(videoId) => {
          setItems((arr) => arr.filter((x) => x.videoId !== videoId));
          remove.mutate({ videoId });
        }}
      />
    </div>
  );
}
