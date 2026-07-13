"use client";

import { type RefObject, useEffect, useRef } from "react";

/**
 * Swipe-to-dismiss for bottom sheets: while the sheet (and every scrollable
 * inside it, checked from the touch target upward) is scrolled to the top, a
 * downward drag moves the sheet with the finger; releasing past ~96px (or
 * flicking faster than ~0.6 px/ms) dismisses, anything less springs back.
 * Upward gestures and mid-scroll gestures fall through to normal scrolling.
 *
 * Attach the returned ref to the sheet panel element (the scrollable,
 * bottom-anchored box — not the backdrop). Uses native touch listeners
 * (`passive: false`) because React registers root touch handlers as passive,
 * which makes `preventDefault` a no-op — and the FIRST downward move must be
 * prevented: WebKit decides gesture ownership at the first touchmove, and
 * once native scrolling claims it, later preventDefault calls are ignored.
 *
 * Known limitation (matches most web sheets, not native iOS): a single
 * gesture that scrolls inner content up to its top does not convert into a
 * sheet drag mid-gesture — lift and pull again.
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
    let velocity = 0;
    let canDrag = false;
    let dragging = false;

    // True when a scrollable between the touch target and the sheet is
    // scrolled down — that gesture belongs to the inner list (e.g. the
    // player sheet's up-next queue), never to the sheet drag.
    const innerScrolled = (target: EventTarget | null): boolean => {
      let node = target instanceof Element ? target : null;
      while (node && node !== el) {
        if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight) {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (
        !t ||
        e.touches.length > 1 ||
        el.scrollTop > 0 ||
        innerScrolled(e.target)
      ) {
        canDrag = false;
        return;
      }
      canDrag = true;
      dragging = false;
      velocity = 0;
      startY = lastY = t.clientY;
      lastT = performance.now();
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || !canDrag) return;
      const dy = t.clientY - startY;
      if (dy < -4 && !dragging) {
        // Upward: a scroll, not a drag.
        canDrag = false;
        return;
      }
      if (dy > 0) {
        // Claim the gesture from the very first downward move — once native
        // scrolling starts, WebKit ignores preventDefault for the rest of it.
        e.preventDefault();
      }
      if (!dragging) {
        if (dy <= 8) return; // slop before the sheet visually moves
        dragging = true;
      }
      const now = performance.now();
      const step = (t.clientY - lastY) / Math.max(1, now - lastT);
      // Smoothed flick velocity: a micro-pause before lift-off shouldn't
      // erase a fast pull, nor one jittery sample fake one.
      velocity = 0.6 * step + 0.4 * velocity;
      lastY = t.clientY;
      lastT = now;
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
