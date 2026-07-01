import type { VideoStoryboard } from "@/server/services/proxy.types";

const DEFAULT_INTERVAL_SEC = 5;

/** Fallback when no storyboard: four keyframes spread across the timeline. */
export function ytimgScrubFrameUrl(
  videoId: string,
  timeSeconds: number,
  durationSeconds: number,
): string {
  const duration = Math.max(1, durationSeconds);
  const ratio = Math.min(1, Math.max(0, timeSeconds / duration));
  const frame = Math.min(3, Math.max(0, Math.round(ratio * 3)));
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${frame}.jpg`;
}

export function scrubFrameMarkers(
  durationSeconds: number,
  intervalSec = DEFAULT_INTERVAL_SEC,
): number[] {
  const duration = Math.max(0, Math.floor(durationSeconds));
  if (duration <= 0) return [0];
  const markers: number[] = [];
  for (let t = 0; t <= duration; t += intervalSec) {
    markers.push(t);
  }
  if (markers[markers.length - 1] !== duration) {
    markers.push(duration);
  }
  return markers;
}

export function storyboardSheetUrl(
  templateUrl: string,
  sheetIndex: number,
): string {
  return templateUrl.replace(/\$M/g, String(sheetIndex));
}

export type StoryboardThumbCoords = {
  sheetIndex: number;
  column: number;
  row: number;
};

export function storyboardThumbAtTime(
  sb: VideoStoryboard,
  timeSeconds: number,
): StoryboardThumbCoords {
  const intervalSec = Math.max(1, sb.intervalMs / 1000);
  const index = Math.min(
    Math.max(0, sb.count - 1),
    Math.floor(Math.max(0, timeSeconds) / intervalSec),
  );
  const perSheet = Math.max(1, sb.columns * sb.rows);
  const sheetIndex = Math.min(
    Math.max(0, sb.storyboardCount - 1),
    Math.floor(index / perSheet),
  );
  const indexInSheet = index % perSheet;
  return {
    sheetIndex,
    column: indexInSheet % sb.columns,
    row: Math.floor(indexInSheet / sb.columns),
  };
}

export function scrubFrameUrlAt(
  videoId: string,
  timeSeconds: number,
  durationSeconds: number,
  storyboard?: VideoStoryboard,
): string {
  if (storyboard?.templateUrl) {
    const coords = storyboardThumbAtTime(storyboard, timeSeconds);
    return storyboardSheetUrl(storyboard.templateUrl, coords.sheetIndex);
  }
  return ytimgScrubFrameUrl(videoId, timeSeconds, durationSeconds);
}

export function scrubFrameBackgroundPosition(
  sb: VideoStoryboard,
  timeSeconds: number,
): string {
  const { column, row } = storyboardThumbAtTime(sb, timeSeconds);
  return `-${column * sb.thumbWidth}px -${row * sb.thumbHeight}px`;
}

export type ScrubFrameStyle = {
  url: string;
  width: number;
  height: number;
  backgroundSize?: string;
  backgroundPosition?: string;
};

export function scrubFrameStyleAt(
  videoId: string,
  timeSeconds: number,
  durationSeconds: number,
  storyboard?: VideoStoryboard,
): ScrubFrameStyle {
  const url = scrubFrameUrlAt(
    videoId,
    timeSeconds,
    durationSeconds,
    storyboard,
  );
  if (storyboard) {
    return {
      url,
      width: storyboard.thumbWidth,
      height: storyboard.thumbHeight,
      backgroundSize: `${storyboard.columns * storyboard.thumbWidth}px ${storyboard.rows * storyboard.thumbHeight}px`,
      backgroundPosition: scrubFrameBackgroundPosition(storyboard, timeSeconds),
    };
  }
  return { url, width: 120, height: 68 };
}
