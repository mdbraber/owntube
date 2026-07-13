"use client";

import { type RefObject, useEffect, useRef } from "react";

/**
 * Swipe-to-dismiss for bottom sheets: while the sheet's content is scrolled
 * to the top, a downward drag moves the sheet with the finger; releasing past
 * ~96px (or flicking faster than ~0.6 px/ms) dismisses, anything less springs
 * back. Upward gestures and mid-scroll gestures fall through to normal
 * scrolling.
 *
 * Attach the returned ref to the sheet panel element (the scrollable,
 * bottom-anchored box — not the backdrop). Uses native touch listeners
 * (`passive: false`) because React registers root touch handlers as passive,
 * which makes `preventDefault` — needed to stop scroll-chaining during the
 * drag — a no-op.
 */
export function useSheetSwipeDismiss(
  onClose: () => void,
): RefObject<HTMLDivElement | null> {
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;

    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let prevY = 0;
    let prevT = 0;
    let canDrag = false;
    let dragging = false;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1 || el.scrollTop > 0) {
        canDrag = false;
        return;
      }
      canDrag = true;
      dragging = false;
      startY = lastY = prevY = t.clientY;
      lastT = prevT = performance.now();
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || !canDrag) return;
      const dy = t.clientY - startY;
      if (!dragging) {
        // A clear downward pull starts the drag; upward means a scroll.
        if (dy > 8) dragging = true;
        else if (dy < -4) {
          canDrag = false;
          return;
        } else return;
      }
      e.preventDefault();
      prevY = lastY;
      prevT = lastT;
      lastY = t.clientY;
      lastT = performance.now();
      el.style.transition = "none";
      el.style.transform = `translateY(${Math.max(0, dy)}px)`;
    };

    const settle = () => {
      if (!dragging) {
        canDrag = false;
        return;
      }
      dragging = false;
      canDrag = false;
      const dy = lastY - startY;
      // Velocity from the last movement sample, not the whole gesture.
      const velocity = (lastY - prevY) / Math.max(1, lastT - prevT);
      el.style.transition = "transform 180ms ease-out";
      if (dy > 96 || velocity > 0.6) {
        el.style.transform = "translateY(105%)";
        window.setTimeout(() => {
          onCloseRef.current();
        }, 160);
      } else {
        el.style.transform = "";
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", settle);
    el.addEventListener("touchcancel", settle);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", settle);
      el.removeEventListener("touchcancel", settle);
    };
  }, []);

  return sheetRef;
}
