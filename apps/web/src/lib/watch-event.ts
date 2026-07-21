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
 * `positionSeconds` (playback head) completes a video independently of dwell:
 * dwell alone under-reports every way a video can legitimately *finish* early —
 * faster playback rates, SponsorBlock skips, scrubbing, or a backgrounded tab
 * (which stops accumulating dwell entirely). Reaching the end is the signal
 * users mean by "watched".
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
  const completed =
    duration > 0 && (elapsed >= COMPLETION_RATIO * duration || reachedEnd);
  return { durationWatched, completed };
}
