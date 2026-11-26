import type { VideoDetail } from "@web/server/catalog/types";
import { type MutableRefObject, useEffect } from "react";
import { trpcClient } from "@/lib/trpc";

/** Matches the web tracker's cadence. */
const SAVE_INTERVAL_MS = 20_000;
/** Fraction of the video that counts as watched. */
const COMPLETION_RATIO = 0.9;
/** Below this there is nothing worth recording or resuming. */
const MIN_TRACKED_SECONDS = 5;

type WatchProgressRefs = {
  detail: MutableRefObject<VideoDetail | null>;
  /** Current playback offset in seconds. */
  position: MutableRefObject<number>;
  playing: MutableRefObject<boolean>;
};

/** History caps duration fields at 24h; clamp so one bad value isn't rejected. */
const MAX_TRACKED_SECONDS = 86_400;

const clamp = (value: number) =>
  Math.min(MAX_TRACKED_SECONDS, Math.max(0, Math.floor(value)));

/**
 * Records watch progress to history: `positionSeconds` for "continue watching",
 * and `durationWatched` as the engagement signal the recommender reads.
 *
 * Saved on an interval as well as on unmount — a TV app is killed rather than
 * closed, so an unmount-only save loses the whole session whenever the user
 * hits Home or the box reclaims memory.
 *
 * `durationWatched` counts only time actually playing, so it is never inflated
 * by a video left paused on screen.
 */
export function useRecordWatchProgress({
  detail,
  position,
  playing,
}: WatchProgressRefs) {
  useEffect(() => {
    let playedMs = 0;
    let lastTick = Date.now();

    const accumulate = () => {
      const now = Date.now();
      if (playing.current) playedMs += now - lastTick;
      lastTick = now;
    };

    const save = () => {
      const current = detail.current;
      if (!current?.channelId) return;
      const positionSeconds = clamp(position.current);
      const playedSeconds = clamp(playedMs / 1000);
      if (playedSeconds < MIN_TRACKED_SECONDS) return;
      const videoDurationSeconds = clamp(current.durationSeconds ?? 0);
      trpcClient.history.upsertEvent
        .mutate({
          videoId: current.videoId,
          channelId: current.channelId,
          durationWatched: playedSeconds,
          positionSeconds,
          completed:
            videoDurationSeconds > 0 &&
            positionSeconds >= videoDurationSeconds * COMPLETION_RATIO,
          videoDurationSeconds,
          isShort: false,
          // Denormalized so history and the Continue watching shelf render
          // without an upstream fetch per row.
          videoTitle: current.title,
          channelName: current.channelName,
        })
        .catch(() => {});
    };

    const interval = setInterval(() => {
      accumulate();
      save();
    }, SAVE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      accumulate();
      save();
    };
  }, [detail, position, playing]);
}
