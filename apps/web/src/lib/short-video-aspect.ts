import type { VideoDetail } from "@/server/services/proxy.types";

/** Vertical (9:16) — the Shorts default and the flash-free initial guess. */
const VERTICAL_ASPECT = 9 / 16;

/** CSS `aspect-ratio` value (width / height). */
export function aspectRatioFromPixelDimensions(
  widthPx: number,
  heightPx: number,
): number {
  if (widthPx <= 0 || heightPx <= 0) return VERTICAL_ASPECT;
  return widthPx / heightPx;
}

/**
 * Initial frame aspect for a short, used only until the &lt;video&gt; element
 * reports real pixel intrinsics.
 *
 * We deliberately always assume vertical (9:16): the /shorts feed is vertical
 * by convention, and stream `height` is an unreliable orientation signal —
 * some upstreams report a vertical short's *quality number* (e.g. 480) as
 * `height`, which reads as landscape and made the frame flash wide-then-tall.
 * A genuinely landscape clip is corrected the instant `loadedmetadata` fires
 * (see {@link aspectRatioFromPixelDimensions}), so nothing is lost by starting
 * vertical, and the common case stops flashing.
 */
export function inferShortAspectRatioFromDetail(
  _detail: VideoDetail | undefined,
): number {
  return VERTICAL_ASPECT;
}
