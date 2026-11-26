/**
 * "Still watching?" for live streams. Every live player polls the server's
 * live manifest every few seconds and the server fetches YouTube's each time
 * (~950 requests an hour), so a broadcast left playing overnight hurts the
 * server's standing with YouTube. After this long without any interaction a
 * live player unloads its source and asks whether anyone is still watching.
 * VOD is never stopped.
 */
export const LIVE_IDLE_STOP_MS = 3 * 60 * 60 * 1000;

/**
 * How often players check for idleness. A periodic check rather than one long
 * timer: timers are throttled or frozen in the background and across sleep,
 * and a check catches up as soon as it runs again.
 */
export const LIVE_IDLE_CHECK_MS = 60 * 1000;

/** True when a live player should stop: live and idle for LIVE_IDLE_STOP_MS. */
export function shouldStopIdleLive(
  lastInteractionAt: number,
  now: number,
  isLive: boolean,
): boolean {
  return isLive && now - lastInteractionAt >= LIVE_IDLE_STOP_MS;
}
