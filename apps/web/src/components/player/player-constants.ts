export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const PLAYER_FILL =
  "h-full w-full max-h-none max-w-none !rounded-none !border-0 !shadow-none !ring-0 [&_video]:h-full [&_video]:w-full [&_video]:object-contain" as const;

export const SHORTS_SHELL_POINTER =
  "pointer-events-none absolute inset-0 h-full w-full [&_[data-controls]]:pointer-events-auto [&_[data-tap-surface]]:pointer-events-auto [&_video]:pointer-events-none" as const;

export const CHAPTER_GAP_PX = 3 as const;

/** Seconds behind the live edge before showing "Go to live". */
export const LIVE_EDGE_SECONDS = 15;

export const SPLIT_START_TIMEOUT_MS = 7_000;

export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}
