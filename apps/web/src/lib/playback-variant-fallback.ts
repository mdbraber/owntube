/** Next progressive quality index when the current stream fails (HD → lower rungs). */
export function nextPlaybackVariantIndex(
  currentIndex: number,
  variantCount: number,
): number | null {
  if (!Number.isFinite(currentIndex) || variantCount <= 0) return null;
  if (currentIndex < 0 || currentIndex >= variantCount) return null;
  if (currentIndex >= variantCount - 1) return null;
  return currentIndex + 1;
}
