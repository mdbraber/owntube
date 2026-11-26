"use client";

import type { DashQualityState } from "@/hooks/use-dash-playback";

export type QualityModel =
  | {
      kind: "progressive";
      index: number;
      setIndex: (i: number, seekSeconds?: number) => void;
      items: { label: string }[];
    }
  | { kind: "none" };

/**
 * The quality menu for a dash.js stream: a synthetic "Auto" (capped ABR) at
 * index 0, then dash.js's own representations. QualityModel is index-based
 * (menu position) while useDashPlayback works in representation ids (stable
 * regardless of dash.js's bitrate-filtered array reordering) — this is the
 * translation between the two. No selector before the manifest has parsed.
 */
export function dashQualityModel(dash: DashQualityState): QualityModel {
  if (dash.items.length === 0) return { kind: "none" };
  const activeItemIndex = dash.items.findIndex((it) => it.id === dash.activeId);
  return {
    kind: "progressive",
    items: [{ label: "Auto" }, ...dash.items],
    index:
      dash.mode === "auto" ? 0 : activeItemIndex >= 0 ? activeItemIndex + 1 : 0,
    setIndex: (i: number) => {
      if (i === 0) {
        dash.setQuality(null);
        return;
      }
      const picked = dash.items[i - 1];
      if (picked) dash.setQuality(picked.id);
    },
  };
}

export type AudioModel =
  | {
      kind: "tracks";
      index: number;
      setIndex: (i: number) => void;
      items: { label: string }[];
    }
  | { kind: "none" };

export function qualityShortLabel(quality: QualityModel): string {
  if (quality.kind === "progressive") {
    const raw = quality.items[quality.index]?.label ?? "";
    const head = raw.split(/\s*·\s*/)[0]?.trim() ?? raw;
    return head || "—";
  }
  return "—";
}
