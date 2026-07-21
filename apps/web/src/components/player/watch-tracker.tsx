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
  const onWatchedRef = useRef(onWatched);
  onWatchedRef.current = onWatched;
  const { mutate } = trpc.history.upsertEvent.useMutation({
    onSuccess: (res, variables) => {
      // Finishing the video drops it from the queue server-side; refresh the
      // cached queue so the /queue page, Up-next and the localStorage mirror
      // (QueueSync) stop offering a video that was just watched.
      if (res.dequeued) {
        void utils.queue.list.invalidate();
        void utils.queue.listDetailed.invalidate();
      }
      // When an event marks the video completed (auto-watched at ≥97% or on
      // ended), refresh the shared progress map so the "Mark watched" button
      // and hide-finished sections flip to watched at once, and notify the host.
      if (variables.completed) {
        onWatchedRef.current?.(variables.videoId);
        void utils.history.list.invalidate();
        void utils.history.progressAll.invalidate();
      }
    },
  });
  /** tRPC’s mutation return object is not referentially stable; do not list it in effect deps. */
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  useEffect(() => {
    const m = mutateRef.current;

    /**
     * Events from *this* video's player only — the page can also hold hover
     * previews and a mini player, whose `pause`/`play`/`ended` must not be
     * recorded against this row.
     */
    const isThisPlayer = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLVideoElement)) return false;
      const root = target.closest("[data-ot-player-root]");
      return root?.getAttribute("data-ot-player-video-id") === videoId;
    };
    const thisPlayerVideo = (): HTMLVideoElement | null => {
      const el = document.querySelector<HTMLVideoElement>(
        "[data-ot-player-root] video",
      );
      return el && isThisPlayer(el) ? el : null;
    };

    /**
     * Dwell accounting: accumulate wall-clock time only while the tab is
     * visible AND this video is actually playing — a paused-but-visible tab
     * must not count, or leaving a video paused partway through eventually
     * crosses the completion ratio on wall-clock time alone and wrongly
     * marks it watched.
     */
    let isPlaying = !(thisPlayerVideo()?.paused ?? false);
    let visibleAccumMs = 0;
    let visibleSince: number | null =
      isPlaying && document.visibilityState === "visible" ? Date.now() : null;

    const elapsedVisibleSeconds = () => {
      const running = visibleSince === null ? 0 : Date.now() - visibleSince;
      return (visibleAccumMs + running) / 1000;
    };

    const pauseAccounting = () => {
      if (visibleSince !== null) {
        visibleAccumMs += Date.now() - visibleSince;
        visibleSince = null;
      }
    };
    const resumeAccounting = () => {
      if (isPlaying && document.visibilityState === "visible") {
        visibleSince ??= Date.now();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resumeAccounting();
      } else {
        pauseAccounting();
        // Losing focus is the moment most likely to precede the tab being
        // throttled or killed — persist immediately. Background playback
        // afterwards is covered by the (browser-throttled) interval.
        m(buildEvent());
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
    const buildEvent = (overrides?: { completed?: true }) => {
      const position = readPositionSeconds();
      const event = computeWatchEvent(
        elapsedVisibleSeconds(),
        durationSeconds,
        isLive,
        position,
      );
      return {
        videoId,
        channelId,
        videoTitle,
        channelName,
        durationWatched: event.durationWatched,
        positionSeconds: position,
        completed: overrides?.completed ?? event.completed,
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
      if (!isThisPlayer(e.target)) return;
      isPlaying = false;
      pauseAccounting();
      m(buildEvent());
    };
    const onMediaPlay = (e: Event) => {
      if (!isThisPlayer(e.target)) return;
      isPlaying = true;
      resumeAccounting();
    };
    /**
     * Playing to the end is the definitive "watched" signal, and it was never
     * recorded: dwell alone misses fast playback, skips and scrubs, and on
     * auto-advance the tracker's unmount event reads the *next* video's
     * position. Persist completion the moment it ends, before either happens.
     */
    const onMediaEnded = (e: Event) => {
      if (isThisPlayer(e.target)) m(buildEvent({ completed: true }));
    };
    const onPageHide = () => m(buildEvent());
    document.addEventListener("pause", onMediaPause, true);
    document.addEventListener("play", onMediaPlay, true);
    document.addEventListener("ended", onMediaEnded, true);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pause", onMediaPause, true);
      document.removeEventListener("play", onMediaPlay, true);
      document.removeEventListener("ended", onMediaEnded, true);
      window.removeEventListener("pagehide", onPageHide);
      // Final flush on unmount/nav; completion side-effects (onWatched +
      // progress/history invalidation) are handled centrally in the mutation's
      // onSuccess when the event is marked completed.
      m(buildEvent());
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
