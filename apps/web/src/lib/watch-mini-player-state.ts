"use client";

export const WATCH_MINI_STATE_KEY = "ot:watch-mini-state";
export const WATCH_MINI_ENABLED_KEY = "ot:mini-player-enabled";

export type WatchMiniPayload =
  | { mode: "hls"; src: string }
  | {
      mode: "progressive";
      variants: (
        | { t: "muxed"; label: string; src: string }
        | {
            t: "split";
            label: string;
            video: string;
            audio: string;
            audioTracks: { label: string; src: string }[];
            defaultAudioIndex?: number;
          }
      )[];
    };

export type WatchMiniState = {
  videoId: string;
  title: string;
  poster?: string;
  payload: WatchMiniPayload;
  currentTime: number;
  qualityIndex?: number;
  volume?: number;
  muted?: boolean;
  /** When true, mini player mounts paused (no autoplay). */
  paused?: boolean;
};

export function readWatchMiniState(): WatchMiniState | null {
  try {
    const raw = window.localStorage.getItem(WATCH_MINI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.videoId !== "string" ||
      typeof obj.title !== "string" ||
      !obj.payload ||
      typeof obj.payload !== "object"
    ) {
      return null;
    }
    const qualityIndex =
      typeof obj.qualityIndex === "number" &&
      Number.isFinite(obj.qualityIndex) &&
      obj.qualityIndex >= 0
        ? Math.floor(obj.qualityIndex)
        : undefined;
    const volume =
      typeof obj.volume === "number" && Number.isFinite(obj.volume)
        ? Math.min(1, Math.max(0, obj.volume))
        : undefined;
    const muted = typeof obj.muted === "boolean" ? obj.muted : undefined;
    const paused = typeof obj.paused === "boolean" ? obj.paused : undefined;
    return {
      videoId: obj.videoId,
      title: obj.title,
      payload: obj.payload as WatchMiniPayload,
      currentTime:
        typeof obj.currentTime === "number" && Number.isFinite(obj.currentTime)
          ? Math.max(0, obj.currentTime)
          : 0,
      poster: typeof obj.poster === "string" ? obj.poster : undefined,
      qualityIndex,
      volume,
      muted,
      paused,
    };
  } catch {
    return null;
  }
}

export function writeWatchMiniState(
  state: WatchMiniState | null,
  notify = true,
): void {
  try {
    if (!state) window.localStorage.removeItem(WATCH_MINI_STATE_KEY);
    else
      window.localStorage.setItem(WATCH_MINI_STATE_KEY, JSON.stringify(state));
    if (notify) window.dispatchEvent(new CustomEvent("ot:watch-mini-updated"));
  } catch {}
}

export function readWatchMiniEnabled(defaultValue = true): boolean {
  try {
    const raw = window.localStorage.getItem(WATCH_MINI_ENABLED_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {}
  return defaultValue;
}

export function writeWatchMiniEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(WATCH_MINI_ENABLED_KEY, enabled ? "1" : "0");
    if (!enabled) window.localStorage.removeItem(WATCH_MINI_STATE_KEY);
    window.dispatchEvent(new CustomEvent("ot:watch-mini-updated"));
  } catch {}
}

export function clearWatchMiniStateForOtherVideo(videoId: string): void {
  const existing = readWatchMiniState();
  if (existing && existing.videoId !== videoId) {
    writeWatchMiniState(null);
  }
}

/** Which corner the mini player snaps to: [t]op/[b]ottom + [l]eft/[r]ight. */
export type MiniCorner = "tl" | "tr" | "bl" | "br";
const WATCH_MINI_CORNER_KEY = "ot:mini-player-corner";
const MINI_CORNERS: readonly MiniCorner[] = ["tl", "tr", "bl", "br"];

export function readMiniCorner(defaultValue: MiniCorner = "br"): MiniCorner {
  try {
    const raw = window.localStorage.getItem(WATCH_MINI_CORNER_KEY);
    if (raw && (MINI_CORNERS as readonly string[]).includes(raw)) {
      return raw as MiniCorner;
    }
  } catch {}
  return defaultValue;
}

export function writeMiniCorner(corner: MiniCorner): void {
  try {
    window.localStorage.setItem(WATCH_MINI_CORNER_KEY, corner);
  } catch {}
}

/** Mini player width in px (desktop; aspect-ratio keeps the height). */
export const MINI_MIN_WIDTH = 260;
export const MINI_MAX_WIDTH = 680;
export const MINI_DEFAULT_WIDTH = 420;
const WATCH_MINI_WIDTH_KEY = "ot:mini-player-width";

export function readMiniWidth(defaultValue = MINI_DEFAULT_WIDTH): number {
  try {
    const raw = window.localStorage.getItem(WATCH_MINI_WIDTH_KEY);
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(n)) {
      return Math.max(MINI_MIN_WIDTH, Math.min(MINI_MAX_WIDTH, n));
    }
  } catch {}
  return defaultValue;
}

export function writeMiniWidth(width: number): void {
  try {
    window.localStorage.setItem(
      WATCH_MINI_WIDTH_KEY,
      String(Math.round(width)),
    );
  } catch {}
}
