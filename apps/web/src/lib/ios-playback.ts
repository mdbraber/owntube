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
