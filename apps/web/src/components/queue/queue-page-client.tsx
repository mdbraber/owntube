"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { DragHandleIcon } from "@/components/videos/video-action-icons";
import { VideoRow } from "@/components/videos/video-row";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

type Item = {
  videoId: string;
  position: number;
  videoTitle: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  channelId: string | null;
  channelName: string | null;
};

/** Movement (px) before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD_PX = 6;

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
  // Press waiting to cross the drag threshold (mouse can grab anywhere on the
  // row; a plain click still clicks through to links/buttons).
  const pending = useRef<{ index: number; x: number; y: number } | null>(null);
  const dragFrom = useRef<number | null>(null);
  /** Pointer offset within the grabbed row, so it sticks under the cursor. */
  const grabDy = useRef(0);
  /** Suppresses the click that follows a completed drag. */
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragY, setDragY] = useState(0);
  /** Mirror of dragY for measurement (state lags inside event handlers). */
  const dragYRef = useRef(0);

  function indexAtY(y: number): number {
    for (let i = 0; i < rowRefs.current.length; i++) {
      const el = rowRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // The lifted row's rect includes its translateY — measure its *slot*
      // instead, otherwise the target index chases the row and jitters.
      const top = i === dragFrom.current ? r.top - dragYRef.current : r.top;
      if (y < top + r.height / 2) return i;
    }
    return rowRefs.current.length - 1;
  }

  function startDrag(e: ReactPointerEvent, index: number) {
    const rowEl = rowRefs.current[index];
    grabDy.current = rowEl ? e.clientY - rowEl.getBoundingClientRect().top : 0;
    rowEl?.setPointerCapture?.(e.pointerId);
    dragFrom.current = index;
    setDragging(index);
    dragYRef.current = 0;
    setDragY(0);
  }

  /** Handle press: drags immediately (and is the touch path — rows scroll). */
  function onHandlePointerDown(e: ReactPointerEvent, index: number) {
    e.preventDefault();
    startDrag(e, index);
  }

  /** Row press (mouse only): arm a threshold so clicks stay clicks. */
  function onRowPointerDown(e: ReactPointerEvent, index: number) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if (dragFrom.current !== null) return;
    pending.current = { index, x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (dragFrom.current === null && pending.current) {
      const dx = e.clientX - pending.current.x;
      const dy = e.clientY - pending.current.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        e.preventDefault();
        startDrag(e, pending.current.index);
        pending.current = null;
        suppressClick.current = true;
      }
      return;
    }
    if (dragFrom.current === null) return;

    const from = dragFrom.current;
    const target = indexAtY(e.clientY);
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
    // Keep the lifted row under the cursor relative to its (possibly new)
    // slot — subtract the current lift to read the slot's true position.
    const rowEl = rowRefs.current[dragFrom.current];
    if (rowEl) {
      const slotTop = rowEl.getBoundingClientRect().top - dragYRef.current;
      const nextY = e.clientY - grabDy.current - slotTop;
      dragYRef.current = nextY;
      setDragY(nextY);
    }
  }

  function onPointerUp() {
    pending.current = null;
    if (dragFrom.current === null) return;
    dragFrom.current = null;
    setDragging(null);
    dragYRef.current = 0;
    setDragY(0);
    reorder.mutate({ videoIds: items.map((i) => i.videoId) });
    // Let the trailing click event fire (and be suppressed) first.
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  function onClickCapture(e: React.MouseEvent) {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
    }
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
        // select-none + suppressed native drag: grabbing a row must not start
        // a text selection or the browser's link/image drag ghost.
        className="select-none space-y-1"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
      >
        {items.map((item, i) => {
          const isDragging = dragging === i;
          return (
            <li
              key={item.videoId}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              onPointerDown={(e) => onRowPointerDown(e, i)}
              style={
                isDragging ? { transform: `translateY(${dragY}px)` } : undefined
              }
              className={cn(
                isDragging &&
                  "relative z-10 cursor-grabbing rounded-[var(--radius-card)] bg-[hsl(var(--card))] shadow-lg ring-1 ring-[hsl(var(--border))]",
              )}
            >
              <VideoRow
                videoId={item.videoId}
                title={item.videoTitle}
                channelId={item.channelId}
                channelName={item.channelName}
                thumbnailUrl={item.thumbnailUrl}
                durationSeconds={item.durationSeconds}
                surface="queue"
                leading={i + 1}
                dragHandle={
                  <button
                    type="button"
                    className="cursor-grab touch-none select-none px-1 py-2 text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))] active:cursor-grabbing"
                    onPointerDown={(e) => onHandlePointerDown(e, i)}
                    aria-label="Drag to reorder"
                  >
                    <DragHandleIcon className="h-[18px] w-[18px]" />
                  </button>
                }
                removeLabel="Remove from queue"
                removeDisabled={remove.isPending}
                onRemove={() => {
                  setItems((arr) =>
                    arr.filter((x) => x.videoId !== item.videoId),
                  );
                  remove.mutate({ videoId: item.videoId });
                }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
