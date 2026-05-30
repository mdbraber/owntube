/** Matches `.ot-video-grid--large` column-gap (1.75rem). */
export const LARGE_VIDEO_GRID_COLUMN_GAP_PX = 28;

/** Shorts per long-form column at the home shelf (~1.5 across one video width). */
export const HOME_SHORTS_PER_VIDEO_COLUMN = 1.5;

/**
 * Counts the resolved column tracks from a computed `grid-template-columns`
 * value (e.g. `"232.5px 232.5px 232.5px"`), as produced by `getComputedStyle`
 * on an `auto-fill` grid.
 */
export function countGridTemplateColumns(gridTemplateColumns: string): number {
  const value = gridTemplateColumns.trim();
  if (!value || value === "none") return 1;
  const tokens = value.split(/\s+/).filter(Boolean);
  return Math.max(1, tokens.length);
}

/** First track width when the browser resolves columns to pixels. */
export function parseFirstGridColumnWidthPx(
  gridTemplateColumns: string,
): number | null {
  const first = gridTemplateColumns.trim().split(/\s+/)[0];
  if (!first?.endsWith("px")) return null;
  const px = Number.parseFloat(first);
  return Number.isFinite(px) && px > 0 ? px : null;
}

export function averageLargeVideoColumnWidthPx(
  containerWidthPx: number,
  columnCount: number,
): number {
  if (containerWidthPx <= 0 || columnCount < 1) return 280;
  const gap = LARGE_VIDEO_GRID_COLUMN_GAP_PX;
  return (containerWidthPx - (columnCount - 1) * gap) / columnCount;
}

export type HomeShortsShelfLayout = {
  displayCount: number;
  /** Width that lets the selected shorts fill one row with normal grid gaps. */
  shortWidthPx: number;
};

/**
 * Sizes home shelf shorts so thumb height ≈ long-form column width: width is
 * columnWidth / 1.5; count scales with resolution (1.5 shorts per column).
 */
export function computeHomeShortsShelfLayout(
  columnCount: number,
  columnWidthPx: number,
  containerWidthPx: number,
): HomeShortsShelfLayout {
  const columns = Math.max(1, columnCount);
  const displayCount = Math.max(
    2,
    Math.round(columns * HOME_SHORTS_PER_VIDEO_COLUMN),
  );
  const safeContainerWidthPx =
    containerWidthPx > 0
      ? containerWidthPx
      : displayCount *
          (Math.max(120, columnWidthPx) / HOME_SHORTS_PER_VIDEO_COLUMN) +
        (displayCount - 1) * LARGE_VIDEO_GRID_COLUMN_GAP_PX;
  const shortWidthPx =
    (safeContainerWidthPx -
      (displayCount - 1) * LARGE_VIDEO_GRID_COLUMN_GAP_PX) /
    displayCount;
  return { displayCount, shortWidthPx };
}
