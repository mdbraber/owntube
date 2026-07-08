"use client";

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";

/** Movement (px) before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD_PX = 6;

/**
 * Shared drag-to-reorder behavior for row lists (queue, playlist items).
 * Mouse presses anywhere on a row arm a threshold — past it the row lifts and
 * follows the cursor while the list reorders live; plain clicks click through.
 * Touch drags via the dedicated handle only, so finger scrolling stays intact.
 *
 * The host renders rows in its own order and calls `commit` with nothing —
 * the hook mutates order through `onMove(from, to)` and reports the drop via
 * `onDrop()`.
 */
export function useRowDrag({
  count,
  onMove,
  onDrop,
}: {
  count: number;
  /** Splice the item from index `from` to index `to` in host state. */
  onMove: (from: number, to: number) => void;
  /** Persist the new order (fires once per completed drag). */
  onDrop: () => void;
}) {
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const pending = useRef<{ index: number; x: number; y: number } | null>(null);
  const dragFrom = useRef<number | null>(null);
  const grabDy = useRef(0);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const dragYRef = useRef(0);

  function indexAtY(y: number): number {
    for (let i = 0; i < count; i++) {
      const el = rowRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // The lifted row's rect includes its translateY — measure its *slot*
      // instead, otherwise the target index chases the row and jitters.
      const top = i === dragFrom.current ? r.top - dragYRef.current : r.top;
      if (y < top + r.height / 2) return i;
    }
    return count - 1;
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

  function onHandlePointerDown(e: ReactPointerEvent, index: number) {
    e.preventDefault();
    startDrag(e, index);
  }

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
      onMove(from, target);
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
    onDrop();
    // Let the trailing click event fire (and be suppressed) first.
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  function onClickCapture(e: ReactMouseEvent) {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  return {
    dragging,
    dragY,
    setRowRef: (index: number) => (el: HTMLElement | null) => {
      rowRefs.current[index] = el;
    },
    /** Spread on the <ul>. */
    listProps: {
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onClickCapture,
      onDragStart: (e: React.DragEvent) => e.preventDefault(),
    },
    rowPointerDown: onRowPointerDown,
    handlePointerDown: onHandlePointerDown,
  };
}
