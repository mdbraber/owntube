"use client";

import { DragHandleIcon } from "@/components/videos/video-action-icons";
import type { VideoActionSurface } from "@/components/videos/video-action-registry";
import { useRowDrag } from "@/components/videos/use-row-drag";
import { VideoRow } from "@/components/videos/video-row";
import { cn } from "@/lib/utils";

export type DraggableRowItem = {
  videoId: string;
  videoTitle: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  channelId: string | null;
  channelName: string | null;
};

/**
 * The ordered, drag-reorderable video list shared by the Queue and playlist
 * detail pages: numbered VideoRows with index⇄handle swap, grab-anywhere
 * mouse drags (lifted row follows the cursor), handle-only touch drags, and
 * a hover ✕ remove.
 */
export function DraggableVideoRows({
  items,
  surface,
  removeLabel,
  removeDisabled,
  onMove,
  onDrop,
  onRemove,
}: {
  items: DraggableRowItem[];
  surface: VideoActionSurface;
  removeLabel: string;
  removeDisabled?: boolean;
  /** Splice from → to in the host's item state (live while dragging). */
  onMove: (from: number, to: number) => void;
  /** Persist the order once a drag completes. */
  onDrop: () => void;
  onRemove: (videoId: string) => void;
}) {
  const drag = useRowDrag({ count: items.length, onMove, onDrop });

  return (
    <ul
      // select-none + suppressed native drag: grabbing a row must not start
      // a text selection or the browser's link/image drag ghost.
      className="select-none space-y-1"
      {...drag.listProps}
    >
      {items.map((item, i) => {
        const isDragging = drag.dragging === i;
        return (
          <li
            key={item.videoId}
            ref={drag.setRowRef(i)}
            onPointerDown={(e) => drag.rowPointerDown(e, i)}
            style={
              isDragging
                ? { transform: `translateY(${drag.dragY}px)` }
                : undefined
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
              surface={surface}
              leading={i + 1}
              dragHandle={
                <button
                  type="button"
                  className="cursor-grab touch-none select-none px-1 py-2 text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))] active:cursor-grabbing"
                  onPointerDown={(e) => drag.handlePointerDown(e, i)}
                  aria-label="Drag to reorder"
                >
                  <DragHandleIcon className="h-[18px] w-[18px]" />
                </button>
              }
              removeLabel={removeLabel}
              removeDisabled={removeDisabled}
              onRemove={() => onRemove(item.videoId)}
            />
          </li>
        );
      })}
    </ul>
  );
}
