/**
 * Pure decision logic for watch-history events, shared with WatchTracker.
 * Dwell time is visible wall-clock seconds, not player position: it is an
 * upper bound on real playback, so completion uses a ratio threshold.
 */

/** Fraction of the video length that counts as a completed watch (tolerates a skipped outro). */
export const COMPLETION_RATIO = 0.97;

export type WatchEventPayload = {
  durationWatched: number;
  completed: boolean;
};

/** Upper bound accepted by the history input schema (24h). */
const MAX_DURATION_WATCHED_SEC = 86_400;

/**
 * Completion is decided by the playback head (`positionSeconds`) alone: the
 * video counts as watched only when the position actually reached the
 * completion ratio (or the player fired `ended`, which the tracker records
 * explicitly). Dwell deliberately does NOT complete: it is wall-clock time
 * and over-reports every way a video can sit playing without being watched
 * through — rewatching one section, a mini player left running, a replayed
 * ending — which used to flip videos to watched by lingering alone. Dwell
 * remains the durationWatched stat.
 */
export function computeWatchEvent(
  elapsedVisibleSeconds: number,
  videoDurationSeconds: number,
  isLive: boolean,
  positionSeconds?: number,
): WatchEventPayload {
  const elapsed = Math.min(
    MAX_DURATION_WATCHED_SEC,
    Math.max(0, Math.floor(elapsedVisibleSeconds)),
  );
  if (isLive) {
    // Live streams have no meaningful total length; session dwell is the signal.
    return { durationWatched: elapsed, completed: false };
  }
  const duration = Math.max(0, Math.floor(videoDurationSeconds));
  const durationWatched = duration > 0 ? Math.min(elapsed, duration) : elapsed;
  const reachedEnd =
    typeof positionSeconds === "number" &&
    Number.isFinite(positionSeconds) &&
    positionSeconds >= COMPLETION_RATIO * duration;
  const completed = duration > 0 && reachedEnd;
  return { durationWatched, completed };
}
