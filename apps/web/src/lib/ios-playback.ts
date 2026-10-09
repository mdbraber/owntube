/**
 * iOS-family browser detection for playback decisions.
 *
 * On iPhone/iPad Safari (and every iOS browser, which must use WebKit), the
 * split video+audio playback path is unreliable: a second unmuted media
 * element is blocked by the autoplay policy and JS-synced dual elements drift
 * or stall. Native HLS or muxed progressive must be preferred there.
 */
export function isIosLikeBrowser(
  userAgent?: string,
  maxTouchPoints?: number,
): boolean {
  const ua =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (!ua) return false;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports a macOS user agent; the touch screen gives it away.
  const touchPoints =
    maxTouchPoints ??
    (typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0);
  return /Macintosh/i.test(ua) && touchPoints > 1;
}

/**
 * Desktop (non-touch) macOS Safari — excludes Chrome/Edge/Firefox, which also
 * carry a "Safari" token in their UA string, and excludes iPadOS (handled by
 * `isIosLikeBrowser`).
 */
export function isDesktopSafariUserAgent(userAgent?: string): boolean {
  const ua =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (!ua || !/Macintosh/i.test(ua) || !/Safari/i.test(ua)) return false;
  return !/Chrome|CriOS|Chromium|Edg|OPR|Firefox|FxiOS/i.test(ua);
}

/**
 * Any WebKit browser where AirPlay is reachable from the video element
 * (`webkitShowPlaybackTargetPicker`): iOS/iPadOS Safari plus desktop macOS
 * Safari. Decisions that would break AirPlay audio (e.g. routing the element
 * through Web Audio) must be skipped up front on all of these, since the
 * viewer can start casting at any moment.
 */
export function isAirPlayCapableWebKit(
  userAgent?: string,
  maxTouchPoints?: number,
): boolean {
  return (
    isIosLikeBrowser(userAgent, maxTouchPoints) ||
    isDesktopSafariUserAgent(userAgent)
  );
}
