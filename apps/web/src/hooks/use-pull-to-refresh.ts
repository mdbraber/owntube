import { type TouchEvent, useCallback, useRef, useState } from "react";

/** Pixels the user must pull past (at the top of the page) to trigger a refresh. */
export const PULL_THRESHOLD = 64;
/** Damping so the indicator trails the finger rather than tracking it 1:1. */
const PULL_DAMPING = 0.5;
const PULL_MAX = 96;

type TouchHandlers = {
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
};

/**
 * Touch pull-to-refresh, armed only when the page is already scrolled to the
 * top. Returns the current pull distance (px) for a hint indicator plus the
 * touch handlers to spread onto the scroll container. Extracted from the
 * subscriptions feed so the home page shares identical feel/thresholds.
 */
export function usePullToRefresh({
  onRefresh,
  disabled = false,
}: {
  onRefresh: () => void;
  /** Suppress the gesture (e.g. while refreshing, or in an edit/drag mode). */
  disabled?: boolean;
}): {
  pull: number;
  thresholdReached: boolean;
  handlers: TouchHandlers;
} {
  const [pull, setPull] = useState(0);
  const pullStartY = useRef<number | null>(null);

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled) {
        pullStartY.current = null;
        return;
      }
      pullStartY.current =
        window.scrollY <= 0 ? (e.touches[0]?.clientY ?? null) : null;
    },
    [disabled],
  );
  const onTouchMove = useCallback((e: TouchEvent) => {
    if (pullStartY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - pullStartY.current;
    setPull(dy > 0 ? Math.min(dy * PULL_DAMPING, PULL_MAX) : 0);
  }, []);
  const onTouchEnd = useCallback(() => {
    if (pullStartY.current !== null && pull >= PULL_THRESHOLD) onRefresh();
    pullStartY.current = null;
    setPull(0);
  }, [pull, onRefresh]);

  return {
    pull,
    thresholdReached: pull >= PULL_THRESHOLD,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
  };
}
