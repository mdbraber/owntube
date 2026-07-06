"use client";

import type { VideoPlayerPayload } from "@/components/player/player-payload";
import {
  type DefaultPlaybackQuality,
  variantIndexForDefaultQuality,
} from "@/lib/default-playback-quality";

export function initialQualityIndexForPayload(
  payload: VideoPlayerPayload,
  preference: DefaultPlaybackQuality,
): number {
  if (payload.mode !== "progressive") return 0;
  return variantIndexForDefaultQuality(payload.variants, preference);
}

export type QualityModel =
  | {
      kind: "progressive";
      index: number;
      setIndex: (i: number, seekSeconds?: number) => void;
      items: { label: string }[];
    }
  | { kind: "none" };

/** Menu rows from the full SSR payload — never the active variant alone. */
export type ProgressiveQualityMenu = {
  kind: "progressive";
  index: number;
  items: { label: string }[];
};

export function progressiveQualityMenuFromPayload(
  payload: VideoPlayerPayload,
  qualityIndex: number,
): ProgressiveQualityMenu | null {
  if (payload.mode !== "progressive" || payload.variants.length === 0) {
    return null;
  }
  return {
    kind: "progressive",
    index: qualityIndex,
    items: payload.variants.map((p) => ({ label: p.label })),
  };
}

export function withProgressiveQualitySetter(
  menu: ProgressiveQualityMenu,
  setQualityIndex: (i: number, seekSeconds?: number) => void,
  seekSeconds: number,
): QualityModel {
  return {
    ...menu,
    setIndex: (i) => setQualityIndex(i, seekSeconds),
  };
}

export type AudioModel =
  | {
      kind: "split-native";
      index: number;
      setIndex: (i: number) => void;
      items: { label: string }[];
    }
  | { kind: "none" };

/** Normalize URL so the same stream behind different query ordering still dedupes. */
function normalizeAudioStreamUrlForCompare(src: string): string {
  const t = src.trim();
  if (!t) return "";
  try {
    const u = new URL(t);
    u.hash = "";
    const entries = [...u.searchParams.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    u.search = "";
    for (const [k, v] of entries) u.searchParams.append(k, v);
    return u.href;
  } catch {
    return t;
  }
}

/** Language picker only when ≥2 distinct stream URLs (after normalization). */
export function hasMultipleDistinctAudioStreams(
  tracks: readonly { src: string }[],
): boolean {
  const urls = new Set<string>();
  for (const t of tracks) {
    const id = normalizeAudioStreamUrlForCompare(t.src ?? "");
    if (id) urls.add(id);
  }
  return urls.size >= 2;
}

export function qualityShortLabel(quality: QualityModel): string {
  if (quality.kind === "progressive") {
    const raw = quality.items[quality.index]?.label ?? "";
    const head = raw.split(/\s*·\s*/)[0]?.trim() ?? raw;
    return head || "—";
  }
  return "—";
}
