"use client";

import { useEffect, useState } from "react";
import {
  type DraggableRowItem,
  DraggableVideoRows,
} from "@/components/videos/draggable-video-rows";
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
      {items.length > 1 ? (
        <div className="flex justify-end">
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
        </div>
      ) : null}
      <DraggableVideoRows
        items={items}
        surface="queue"
        removeLabel="Remove from queue"
        removeDisabled={remove.isPending}
        onMove={(from, to) =>
          setItems((arr) => {
            const next = [...arr];
            const [m] = next.splice(from, 1);
            next.splice(to, 0, m);
            return next;
          })
        }
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
