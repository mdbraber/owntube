"use client";

import { useMediaRemote, useMediaStore } from "@vidstack/react";
import type { MediaPlayerElement } from "vidstack";
import type { VideoPlayerPayload } from "@/components/player/player-payload";
import {
  audioTrackLanguageInfo,
  languageFirstAudioMenuLabel,
} from "@/lib/audio-track-label";
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
  | {
      kind: "hls-managed";
      auto: boolean;
      items: { label: string; selected: boolean; idx: number }[];
      canSet: boolean;
      remote: ReturnType<typeof useMediaRemote>;
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
  | {
      kind: "hls-managed";
      items: { label: string; selected: boolean; idx: number }[];
      remote: ReturnType<typeof useMediaRemote>;
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

const HLS_LADDER = [2160, 1080, 720, 480, 360] as const;

function snapHlsHeightToRung(h: number): (typeof HLS_LADDER)[number] | null {
  let best: (typeof HLS_LADDER)[number] | null = null;
  let bestD = Infinity;
  for (const rung of HLS_LADDER) {
    const d = Math.abs(h - rung);
    if (d < bestD) {
      bestD = d;
      best = rung;
    }
  }
  if (!best) return null;
  if (bestD <= Math.max(56, best * 0.22)) return best;
  return null;
}

export function useHlsQualityModel(
  playerRef: React.RefObject<MediaPlayerElement | null>,
): QualityModel {
  const state = useMediaStore(playerRef as React.RefObject<EventTarget | null>);
  const remote = useMediaRemote(
    playerRef as React.RefObject<EventTarget | null>,
  );
  if (state.qualities.length === 0 || !state.canSetQuality) {
    return { kind: "none" };
  }
  const withIdx = state.qualities.map((q, idx) => ({ q, idx }));
  /** Exclut pistes sans hauteur utile (ex. audio seul). */
  const videoRenditions = withIdx.filter(({ q }) => q.height > 0);
  const bestByTier = new Map<
    (typeof HLS_LADDER)[number],
    { q: (typeof withIdx)[number]["q"]; idx: number }
  >();
  for (const { q, idx } of videoRenditions) {
    const tier = snapHlsHeightToRung(q.height);
    if (!tier) continue;
    const prev = bestByTier.get(tier);
    if (!prev || q.height > prev.q.height) bestByTier.set(tier, { q, idx });
  }
  const ladder: { label: string; selected: boolean; idx: number }[] = [];
  for (const tier of HLS_LADDER) {
    const hit = bestByTier.get(tier);
    if (hit) {
      ladder.push({
        label: `${tier}p`,
        selected: Boolean(hit.q.selected && !state.autoQuality),
        idx: hit.idx,
      });
    }
  }
  const resItems =
    ladder.length > 0
      ? ladder
      : videoRenditions.map(({ q, idx }) => ({
          label: q.height ? `${q.height}p` : `${q.width}×${q.height}`,
          selected: Boolean(q.selected && !state.autoQuality),
          idx,
        }));
  const items: { label: string; selected: boolean; idx: number }[] = [
    {
      label: "Auto",
      selected: state.autoQuality,
      idx: -1,
    },
    ...resItems,
  ];
  return {
    kind: "hls-managed",
    auto: state.autoQuality,
    canSet: state.canSetQuality,
    remote,
    items,
  };
}

/**
 * hls.js often exposes synthetic labels (`audio_0`, `track2`, `und`) that
 * survive `languageFirstAudioMenuLabel` because they look "non-empty" enough
 * to short-circuit the language inference. Treat these as junk so the picker
 * can fall back to a more useful string instead of showing them verbatim.
 */
function looksLikeGenericHlsAudioLabel(
  label: string | undefined | null,
): boolean {
  const t = label?.trim().toLowerCase() ?? "";
  if (!t) return true;
  if (t === "audio" || t === "track" || t === "und" || t === "default") {
    return true;
  }
  return /^(audio|track|stream|media)[\s_-]*\d+$/i.test(t);
}

export function useHlsAudioModel(
  playerRef: React.RefObject<MediaPlayerElement | null>,
): AudioModel {
  const state = useMediaStore(playerRef as React.RefObject<EventTarget | null>);
  const remote = useMediaRemote(
    playerRef as React.RefObject<EventTarget | null>,
  );
  if (state.audioTracks.length < 2) return { kind: "none" };

  type Row = { label: string; selected: boolean; idx: number; key: string };
  const rows: Row[] = state.audioTracks.map((t, idx) => {
    const info = audioTrackLanguageInfo({
      displayName: t.label || undefined,
      language: t.language || undefined,
      trackId: t.id,
    });
    // When language inference fails, prefer the upstream label if it looks
    // like a real human string (`English Dub`, `Commentary`, `Original`)
    // rather than the synthetic `audio_0` strings hls.js often emits — those
    // we drop to give `languageFirstAudioMenuLabel` a chance to surface the
    // track kind, then fall through to a `Track N` numbered entry.
    const rawLabel = t.label?.trim();
    const labelIsUseful =
      Boolean(rawLabel) && !looksLikeGenericHlsAudioLabel(rawLabel);
    const label = labelIsUseful
      ? (info.name ?? rawLabel ?? `Track ${idx + 1}`)
      : languageFirstAudioMenuLabel({
          displayName: undefined,
          language: t.language || undefined,
          qualityFallback: null,
          trackId: t.id,
          kind: t.kind,
          index: idx,
        });
    return {
      idx,
      selected: t.selected,
      // Unknown-language rows must keep distinct keys so two synthetic dubs
      // with the same generic label are not collapsed into a single row.
      key: info.key ?? `__hls-unknown:${idx}`,
      label,
    };
  });

  // Collapse same-language HLS tracks into a single language picker row;
  // prefer whichever variant the player currently has selected so the menu
  // checkmark doesn't desync from playback.
  const byKey = new Map<string, Row>();
  for (const r of rows) {
    const prev = byKey.get(r.key);
    if (!prev) byKey.set(r.key, r);
    else if (r.selected && !prev.selected) byKey.set(r.key, r);
  }
  const itemsWithKey = Array.from(byKey.values()).sort((a, b) => a.idx - b.idx);
  if (itemsWithKey.length < 2) return { kind: "none" };
  // hls.js often exposes two renditions with no LANGUAGE metadata — both get
  // synthetic `__hls-unknown:*` keys. That is still a single logical stream for
  // the user; hide the fake "language" menu.
  const allSyntheticUnknown = itemsWithKey.every((r) =>
    r.key.startsWith("__hls-unknown:"),
  );
  if (allSyntheticUnknown) return { kind: "none" };

  return {
    kind: "hls-managed",
    remote,
    items: itemsWithKey.map(({ key: _key, ...rest }) => rest),
  };
}

export function qualityShortLabel(quality: QualityModel): string {
  if (quality.kind === "progressive") {
    const raw = quality.items[quality.index]?.label ?? "";
    const head = raw.split(/\s*·\s*/)[0]?.trim() ?? raw;
    return head || "—";
  }
  if (quality.kind === "hls-managed") {
    if (quality.auto) return "Auto";
    const sel = quality.items.find((i) => i.selected);
    const raw = sel?.label ?? quality.items[0]?.label ?? "";
    const head = raw.split(/\s*·\s*/)[0]?.trim() ?? raw;
    return head || "Auto";
  }
  return "—";
}
