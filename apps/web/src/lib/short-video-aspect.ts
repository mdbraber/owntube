import type { VideoDetail } from "@/server/services/proxy.types";

function streamHeightPx(
  source: VideoDetail["videoSources"][number],
): number | null {
  if (typeof source.height === "number" && source.height > 0) {
    return source.height;
  }
  return null;
}

/** CSS `aspect-ratio` value (width / height). */
export function aspectRatioFromPixelDimensions(
  widthPx: number,
  heightPx: number,
): number {
  if (widthPx <= 0 || heightPx <= 0) return 9 / 16;
  return widthPx / heightPx;
}

/**
 * Best-effort aspect before the &lt;video&gt; element reports intrinsics. Vertical
 * Shorts usually expose the long edge as `height` in stream metadata.
 */
export function inferShortAspectRatioFromDetail(
  detail: VideoDetail | undefined,
): number {
  const heights = (detail?.videoSources ?? [])
    .map(streamHeightPx)
    .filter((h): h is number => h != null);
  if (heights.length === 0) return 9 / 16;
  const maxHeight = Math.max(...heights);
  if (maxHeight >= 900) return 9 / 16;
  if (maxHeight <= 520) return 16 / 9;
  return 9 / 16;
}
