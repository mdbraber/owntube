"use client";

import { useEffect, useRef } from "react";
import { LIVE_IDLE_CHECK_MS, shouldStopIdleLive } from "@/lib/live-idle-stop";

/** Anything the viewer does on the page counts as still watching. */
const INTERACTION_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "touchstart",
  "wheel",
] as const;

/**
 * Calls `onIdle` once a live stream has played LIVE_IDLE_STOP_MS without any
 * pointer, keyboard or touch input on the page (see live-idle-stop.ts). The
 * clock starts when `enabled` turns true. A hidden tab or Picture-in-Picture
 * with nobody touching the page counts as idle.
 */
export function useLiveIdleStop(enabled: boolean, onIdle: () => void): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    let lastInteractionAt = Date.now();
    const onInteraction = () => {
      lastInteractionAt = Date.now();
    };
    const check = () => {
      if (shouldStopIdleLive(lastInteractionAt, Date.now(), true)) {
        onIdleRef.current();
      }
    };
    const opts = { capture: true, passive: true } as const;
    for (const type of INTERACTION_EVENTS) {
      window.addEventListener(type, onInteraction, opts);
    }
    const timer = window.setInterval(check, LIVE_IDLE_CHECK_MS);
    return () => {
      window.clearInterval(timer);
      for (const type of INTERACTION_EVENTS) {
        window.removeEventListener(type, onInteraction, opts);
      }
    };
  }, [enabled]);
}
