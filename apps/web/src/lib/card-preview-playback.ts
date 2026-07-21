import {
  type ProxiedPlayableVariant,
  toProxiedOrDirectPlayback,
  toProxiedOrDirectVariants,
} from "@/lib/invidious-proxy";
import { buildWatchPlayback } from "@/lib/pick-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

export type CardPreviewPlayback =
  | { kind: "muxed"; src: string }
  | { kind: "split"; videoSrc: string; audioSrc: string }
  | { kind: "hls"; src: string };

/**
 * Target max height for hover preview (best-first variant list). 360p keeps a
 * muxed itag in reach so one URL carries video+audio together when upstream
 * exposes it; HLS unchanged.
 */
const PREVIEW_MAX_HEIGHT_PX = 360;

function heightFromQualityLabel(label: string): number | null {
  const m = label.match(/(\d{2,4})\s*p/i);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function streamHeightPx(s: VideoDetail["videoSources"][number]): number | null {
  if (typeof s.height === "number" && s.height > 0) return s.height;
  if (s.quality) return heightFromQualityLabel(s.quality);
  return null;
}

function isDashOrHlsUrl(url: string): boolean {
  const l = url.toLowerCase();
  return (
    l.includes(".m3u8") ||
    l.includes("/manifest/hls/") ||
    l.includes(".mpd") ||
    l.includes("/manifest/dash/") ||
    l.includes("/api/manifest/dash")
  );
}

function qualityLooksHighRes(quality: string | undefined): boolean {
  const q = (quality ?? "").toLowerCase();
  return /2160|1440|1080|720|480|4k|uhd|hd1080|hd720|hd1440|hd2160/.test(q);
}

function isProgressiveMuxed(s: VideoDetail["videoSources"][number]): boolean {
  if (!s.url || isDashOrHlsUrl(s.url)) return false;
  if (s.videoOnly === true) return false;
  const mt = (s.mimeType ?? "").toLowerCase();
  if (mt.startsWith("audio/")) return false;
  return true;
}

function isLikelyPreviewMuxed(s: VideoDetail["videoSources"][number]): boolean {
  if (!isProgressiveMuxed(s)) return false;
  const height = streamHeightPx(s);
  if (height !== null) return height <= PREVIEW_MAX_HEIGHT_PX;
  return !qualityLooksHighRes(s.quality);
}

/**
 * Hover preview needs a single progressive URL when possible. Watch playback
 * may drop low-rung muxed rows when split exists; raw `videoSources` still
 * expose the legacy combined itag (often 360p) that previews prefer.
 */
function findPreviewMuxedUrl(detail: VideoDetail): string | null {
  let best: { url: string; score: number } | null = null;
  for (const s of detail.videoSources) {
    if (!isLikelyPreviewMuxed(s)) continue;
    if (!s.url) continue;
    const height = streamHeightPx(s) ?? PREVIEW_MAX_HEIGHT_PX;
    const br =
      typeof s.bitrate === "number" && Number.isFinite(s.bitrate)
        ? s.bitrate
        : height * 500_000;
    const score = height * 10_000 + br;
    if (!best || score < best.score) {
      best = { url: s.url, score };
    }
  }
  return best?.url ?? null;
}

/** Silent video-only preview when no muxed row exists (muted card hover). */
function findPreviewVideoOnlyUrl(detail: VideoDetail): string | null {
  let best: { url: string; score: number } | null = null;
  for (const s of detail.videoSources) {
    if (!s.url || s.videoOnly !== true || isDashOrHlsUrl(s.url)) continue;
    const mt = (s.mimeType ?? "").toLowerCase();
    if (mt.startsWith("audio/")) continue;
    const height = streamHeightPx(s);
    if (height !== null && height > PREVIEW_MAX_HEIGHT_PX) continue;
    if (height === null && qualityLooksHighRes(s.quality)) continue;
    const br =
      typeof s.bitrate === "number" && Number.isFinite(s.bitrate)
        ? s.bitrate
        : (height ?? PREVIEW_MAX_HEIGHT_PX) * 500_000;
    const score = (height ?? PREVIEW_MAX_HEIGHT_PX) * 10_000 + br;
    if (!best || score < best.score) {
      best = { url: s.url, score };
    }
  }
  return best?.url ?? null;
}

/**
 * Prefer muxed (one URL = video+audio in sync) when possible, then any rung
 * ≤360p (lowest first for faster start), then lowest muxed, then lowest overall.
 */
function pickPreviewProxiedVariant(
  variants: ProxiedPlayableVariant[],
): ProxiedPlayableVariant | null {
  if (variants.length === 0) return null;

  for (const v of variants) {
    const h = heightFromQualityLabel(v.label);
    if (h !== null && h <= PREVIEW_MAX_HEIGHT_PX && v.t === "muxed") {
      return v;
    }
  }
  for (let i = variants.length - 1; i >= 0; i--) {
    const v = variants[i];
    if (!v) continue;
    const h = heightFromQualityLabel(v.label);
    if (h !== null && h <= PREVIEW_MAX_HEIGHT_PX) return v;
  }
  for (let i = variants.length - 1; i >= 0; i--) {
    const v = variants[i];
    if (v && v.t === "muxed") return v;
  }
  return variants[variants.length - 1] ?? variants[0] ?? null;
}

/**
 * A `/yt-hls?url=…` src is our server fetching googlevideo directly. Those
 * stream URLs are IP-bound to the upstream instance that resolved them, so the
 * server-IP replay 403s (see the buildWatchPlayback note preferring the
 * synthesized `/hls` manifest over native `hlsUrl` for the same reason).
 */
function isYouTubeHopSrc(src: string): boolean {
  return src.includes("/yt-hls?");
}

/**
 * Resolves playback URLs for in-card hover preview. Progressive: prefer muxed
 * ≤360p (single URL); otherwise split under cap, then lowest muxed, then lowest
 * rung. HLS: full adaptive manifest.
 *
 * Picks that would stream through the 403-prone `/yt-hls` hop are demoted to a
 * last resort — the watch player's source decision (synthesized `/hls`
 * manifest with companion-backed segments) takes their place.
 */
export function cardPreviewPlaybackFromDetail(
  detail: VideoDetail,
  appOrigin: string,
  requestHost: string,
): CardPreviewPlayback | null {
  let ytHopFallback: CardPreviewPlayback | null = null;

  const directMuxed = findPreviewMuxedUrl(detail);
  if (directMuxed) {
    const src = toProxiedOrDirectPlayback(
      directMuxed,
      appOrigin,
      requestHost,
      detail,
    );
    if (!isYouTubeHopSrc(src)) return { kind: "muxed", src };
    ytHopFallback = { kind: "muxed", src };
  }

  const silentVideo = findPreviewVideoOnlyUrl(detail);
  if (silentVideo) {
    const src = toProxiedOrDirectPlayback(
      silentVideo,
      appOrigin,
      requestHost,
      detail,
    );
    if (!isYouTubeHopSrc(src)) return { kind: "muxed", src };
    ytHopFallback ??= { kind: "muxed", src };
  }

  const raw = buildWatchPlayback(detail);
  if (raw.kind === "hls") {
    const src = toProxiedOrDirectPlayback(
      raw.url,
      appOrigin,
      requestHost,
      detail,
    );
    return { kind: "hls", src };
  }
  if (raw.kind === "progressive") {
    const variants = toProxiedOrDirectVariants(
      raw.variants,
      appOrigin,
      requestHost,
      detail,
    );
    const pick = pickPreviewProxiedVariant(variants);
    if (pick?.t === "muxed") {
      if (!isYouTubeHopSrc(pick.src)) return { kind: "muxed", src: pick.src };
      ytHopFallback ??= { kind: "muxed", src: pick.src };
    } else if (pick) {
      if (!isYouTubeHopSrc(pick.video)) {
        return { kind: "split", videoSrc: pick.video, audioSrc: pick.audio };
      }
      ytHopFallback ??= {
        kind: "split",
        videoSrc: pick.video,
        audioSrc: pick.audio,
      };
    }
  }
  return ytHopFallback;
}
