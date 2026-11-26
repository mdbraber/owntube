import { z } from "zod";

export const defaultPlaybackQualitySchema = z.enum([
  "1080p",
  "720p",
  "480p",
  "360p",
  "360p-muxed",
  "best",
]);

export type DefaultPlaybackQuality = z.infer<
  typeof defaultPlaybackQualitySchema
>;

export const DEFAULT_PLAYBACK_QUALITY: DefaultPlaybackQuality = "1080p";

export const DEFAULT_PLAYBACK_QUALITY_SELECT_OPTIONS: {
  value: DefaultPlaybackQuality;
  label: string;
}[] = [
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p — fast start (recommended)" },
  { value: "480p", label: "480p" },
  { value: "360p", label: "360p" },
  { value: "best", label: "Best available" },
];

const STORAGE_KEY = "owntube:defaultPlaybackQuality";

export function readDefaultPlaybackQuality(): DefaultPlaybackQuality {
  if (typeof window === "undefined") return DEFAULT_PLAYBACK_QUALITY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLAYBACK_QUALITY;
    const parsed = defaultPlaybackQualitySchema.safeParse(raw);
    return parsed.success ? parsed.data : DEFAULT_PLAYBACK_QUALITY;
  } catch {
    return DEFAULT_PLAYBACK_QUALITY;
  }
}

export function writeDefaultPlaybackQuality(
  value: DefaultPlaybackQuality,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* quota / private mode */
  }
}

/**
 * Plain height ceiling for a default-quality preference — used by DASH's ABR cap
 * (no `{label,t}` variant list to match against, just a number). `null` means no
 * cap ("best"). `"360p-muxed"`, a setting from before progressive playback was
 * dropped, reads as `"360p"`.
 */
export function heightCapForDefaultQuality(
  preference: DefaultPlaybackQuality = DEFAULT_PLAYBACK_QUALITY,
): number | null {
  switch (preference) {
    case "best":
      return null;
    case "1080p":
      return 1080;
    case "720p":
      return 720;
    case "480p":
      return 480;
    case "360p":
    case "360p-muxed":
      return 360;
  }
}
