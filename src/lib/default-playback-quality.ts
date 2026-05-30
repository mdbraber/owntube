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
  { value: "1080p", label: "1080p (recommended)" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
  { value: "360p", label: "360p" },
  { value: "360p-muxed", label: "360p muxed — fastest start (Piped)" },
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

function heightFromQualityLabel(label: string): number | null {
  const head = label.split(/\s*·\s*/)[0]?.trim() ?? label;
  const m = head.match(/(\d{2,4})\s*p/i);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Pick a variant row index for the user's default quality preference. */
export function variantIndexForDefaultQuality(
  variants: ReadonlyArray<{ label: string; t?: string }>,
  preference: DefaultPlaybackQuality = DEFAULT_PLAYBACK_QUALITY,
): number {
  if (variants.length === 0) return 0;
  if (preference === "best") return 0;

  if (preference === "360p-muxed") {
    const muxedLow = variants.findIndex(
      (v) =>
        v.t === "muxed" &&
        ((heightFromQualityLabel(v.label) ?? 999) <= 480 ||
          /360/i.test(v.label)),
    );
    if (muxedLow >= 0) return muxedLow;
    const anyMuxed = variants.findIndex((v) => v.t === "muxed");
    if (anyMuxed >= 0) return anyMuxed;
  }

  const target =
    preference === "1080p"
      ? 1080
      : preference === "720p"
        ? 720
        : preference === "480p"
          ? 480
          : 360;

  const exact = variants.findIndex(
    (v) => heightFromQualityLabel(v.label) === target,
  );
  if (exact >= 0) return exact;

  if (preference === "360p") {
    const low = variants.findIndex((v) => {
      const h = heightFromQualityLabel(v.label);
      return h !== null && h <= 360;
    });
    if (low >= 0) return low;
  }

  return 0;
}

/** Move the preferred default variant to the front of the list (Piped watch page). */
export function reorderVariantsForDefaultQuality<
  T extends { label: string; t?: string },
>(
  variants: T[],
  preference: DefaultPlaybackQuality = DEFAULT_PLAYBACK_QUALITY,
): T[] {
  if (variants.length <= 1) return variants;
  const idx = variantIndexForDefaultQuality(variants, preference);
  if (idx <= 0) return variants;
  const out = [...variants];
  const [pick] = out.splice(idx, 1);
  return [pick, ...out];
}
