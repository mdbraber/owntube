"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { LibraryVideoRow } from "@/components/library/library-video-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

type Item = {
  videoId: string;
  position: number;
  videoTitle: string;
  thumbnailUrl?: string;
  channelId: string | null;
  channelName: string | null;
};

function DragHandle() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
      className="opacity-60"
    >
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

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

  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const dragFrom = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  function indexAtY(y: number): number {
    for (let i = 0; i < rowRefs.current.length; i++) {
      const el = rowRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return rowRefs.current.length - 1;
  }

  function onPointerDown(e: ReactPointerEvent, index: number) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragFrom.current = index;
    setDragging(index);
  }
  function onPointerMove(e: ReactPointerEvent) {
    if (dragFrom.current === null) return;
    const target = indexAtY(e.clientY);
    const from = dragFrom.current;
    if (target !== from && target >= 0) {
      setItems((arr) => {
        const next = [...arr];
        const [m] = next.splice(from, 1);
        next.splice(target, 0, m);
        return next;
      });
      dragFrom.current = target;
      setDragging(target);
    }
  }
  function onPointerUp() {
    if (dragFrom.current === null) return;
    dragFrom.current = null;
    setDragging(null);
    reorder.mutate({ videoIds: items.map((i) => i.videoId) });
  }

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
      <ul
        className="space-y-3"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {items.map((item, i) => (
          <li
            key={item.videoId}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            className={cn("transition", dragging === i ? "opacity-70" : "")}
          >
            <LibraryVideoRow
              videoId={item.videoId}
              title={item.videoTitle}
              channelId={item.channelId}
              channelName={item.channelName}
              thumbnailUrl={item.thumbnailUrl}
              leading={
                <button
                  type="button"
                  className="cursor-grab touch-none select-none px-1 py-2 active:cursor-grabbing"
                  onPointerDown={(e) => onPointerDown(e, i)}
                  aria-label="Drag to reorder"
                >
                  <DragHandle />
                </button>
              }
              trailing={
                <Button
                  variant="outline"
                  onClick={() => {
                    setItems((arr) =>
                      arr.filter((x) => x.videoId !== item.videoId),
                    );
                    remove.mutate({ videoId: item.videoId });
                  }}
                  disabled={remove.isPending}
                >
                  Remove
                </Button>
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
