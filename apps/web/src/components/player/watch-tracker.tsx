"use client";

import { useEffect, useRef } from "react";
import { computeWatchEvent } from "@/lib/watch-event";
import { trpc } from "@/trpc/react";

type WatchTrackerProps = {
  videoId: string;
  channelId?: string;
  /** Denormalized into watch_history so history search/display skip upstream fetches. */
  videoTitle?: string;
  channelName?: string;
  durationSeconds?: number;
  /** Use session elapsed time instead of VOD duration (live streams). */
  isLive?: boolean;
  /** Recorded from the Shorts feed — excluded from the long-form recommendation signal. */
  isShort?: boolean;
  /** Called after the final watch event is persisted (e.g. leave slide / unmount). */
  onWatched?: (videoId: string) => void;
};

export function WatchTracker({
  videoId,
  channelId = "unknown",
  videoTitle,
  channelName,
  durationSeconds = 0,
  isLive = false,
  isShort = false,
  onWatched,
}: WatchTrackerProps) {
  const utils = trpc.useUtils();
  const { mutate } = trpc.history.upsertEvent.useMutation();
  /** tRPC’s mutation return object is not referentially stable; do not list it in effect deps. */
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const onWatchedRef = useRef(onWatched);
  onWatchedRef.current = onWatched;
  const invalidateHistoryRef = useRef(() => {
    void utils.history.list.invalidate();
  });
  invalidateHistoryRef.current = () => {
    void utils.history.list.invalidate();
  };

  useEffect(() => {
    const m = mutateRef.current;
    /**
     * Dwell accounting: accumulate wall-clock time only while the tab is
     * visible, so background tabs don't inflate watch time. This is an upper
     * bound on real playback (a paused-but-visible tab still counts).
     */
    let visibleAccumMs = 0;
    let visibleSince: number | null =
      document.visibilityState === "visible" ? Date.now() : null;

    const elapsedVisibleSeconds = () => {
      const running = visibleSince === null ? 0 : Date.now() - visibleSince;
      return (visibleAccumMs + running) / 1000;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        visibleSince ??= Date.now();
      } else if (visibleSince !== null) {
        visibleAccumMs += Date.now() - visibleSince;
        visibleSince = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    /**
     * Live rows keep videoDurationSeconds=0: dwell/length ratios are
     * meaningless there. Clamped because upstreams send `-1` for unknown
     * lengths (and occasionally floats) — the tRPC input schema is
     * `int().min(0)` and a single bad value must not void the whole event.
     */
    const reportedDuration = isLive
      ? 0
      : Math.min(86_400, Math.max(0, Math.floor(durationSeconds || 0)));
    /** Exact playback position from the main watch player, for accurate resume. */
    const readPositionSeconds = (): number | undefined => {
      if (isLive) return undefined;
      const el = document.querySelector<HTMLVideoElement>(
        "[data-ot-player-root] video",
      );
      if (!el || !Number.isFinite(el.currentTime)) return undefined;
      return Math.min(86_400, Math.max(0, Math.floor(el.currentTime)));
    };
    const buildEvent = () => {
      const event = computeWatchEvent(
        elapsedVisibleSeconds(),
        durationSeconds,
        isLive,
      );
      return {
        videoId,
        channelId,
        videoTitle,
        channelName,
        durationWatched: event.durationWatched,
        positionSeconds: readPositionSeconds(),
        completed: event.completed,
        videoDurationSeconds: reportedDuration,
        isShort,
      };
    };

    m({
      videoId,
      channelId,
      videoTitle,
      channelName,
      durationWatched: 0,
      completed: false,
      videoDurationSeconds: reportedDuration,
      isShort,
    });
    const interval = window.setInterval(() => {
      m(buildEvent());
    }, 20_000);

    // Capture the position promptly on the events most likely to precede losing
    // it: pausing, and the tab being hidden or closed (pagehide). `pause` does
    // not bubble, so listen in the capture phase and ignore companion <audio>.
    const onMediaPause = (e: Event) => {
      if ((e.target as HTMLElement | null)?.tagName === "VIDEO") {
        m(buildEvent());
      }
    };
    const onPageHide = () => m(buildEvent());
    document.addEventListener("pause", onMediaPause, true);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pause", onMediaPause, true);
      window.removeEventListener("pagehide", onPageHide);
      m(buildEvent(), {
        onSuccess: () => {
          onWatchedRef.current?.(videoId);
          invalidateHistoryRef.current();
        },
      });
    };
  }, [
    channelId,
    channelName,
    durationSeconds,
    isLive,
    isShort,
    videoId,
    videoTitle,
  ]);

  return null;
}
