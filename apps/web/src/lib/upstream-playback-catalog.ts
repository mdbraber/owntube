import { isYoutubeFamilyHostname } from "@/lib/invidious-proxy";
import type { VideoDetail } from "@/server/services/proxy.types";

type StreamRow = VideoDetail["videoSources"][number];

function heightFromQualityLabel(quality: string | undefined): number | null {
  if (!quality?.trim()) return null;
  const m = quality.match(/(\d{2,4})\s*p/i);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Best-effort height for one upstream stream row (metadata is often incomplete on Piped). */
export function streamRowMaxHeightPx(s: StreamRow): number | null {
  if (
    typeof s.height === "number" &&
    Number.isFinite(s.height) &&
    s.height > 0
  ) {
    return s.height;
  }
  return heightFromQualityLabel(s.quality);
}

/** Highest progressive rung advertised in `videoSources` (0 when unknown / none). */
export function playbackCatalogMaxHeightPx(detail: VideoDetail): number {
  let max = 0;
  for (const s of detail.videoSources) {
    if (!s.url) continue;
    const h = streamRowMaxHeightPx(s);
    if (h !== null && h > max) max = h;
  }
  return max;
}

function hasUsableAudioForSplit(detail: VideoDetail): boolean {
  return (detail.audioSources ?? []).some((a) => Boolean(a.url?.trim()));
}

/** True when split (video-only + audio) HD is available from upstream metadata. */
export function hasSplitHdCapability(detail: VideoDetail): boolean {
  if (!hasUsableAudioForSplit(detail)) return false;
  return detail.videoSources.some((s) => {
    if (!s.url || s.videoOnly !== true) return false;
    const h = streamRowMaxHeightPx(s);
    return h !== null && h > 360;
  });
}

/**
 * Piped instances often return only legacy itag 18 (360p muxed) while Invidious
 * still exposes the full adaptive ladder — prefer a second upstream fetch.
 */
export function shouldPreferInvidiousOverPiped(
  pipedDetail: VideoDetail,
): boolean {
  if (pipedDetail.sourceUsed !== "piped") return false;
  if (pipedDetail.hlsUrl?.trim()) return false;
  if (hasSplitHdCapability(pipedDetail)) return false;
  return playbackCatalogMaxHeightPx(pipedDetail) <= 360;
}

/** Compare two upstream catalogs; higher max height wins (ties keep the incumbent). */
export type UpstreamPlaybackSource = VideoDetail["sourceUsed"];

function liveDetailHasHls(
  detail: VideoDetail | null | undefined,
): detail is VideoDetail {
  return Boolean(detail?.isLive && detail.hlsUrl?.trim());
}

/**
 * Pick Piped vs Invidious for an active live broadcast. Default prefers Piped
 * when it exposes HLS (Piped proxy often survives where raw googlevideo fails).
 */
export function pickLivePlaybackDetail(
  piped: VideoDetail | null,
  invidious: VideoDetail | null,
  prefer?: UpstreamPlaybackSource,
): VideoDetail | null {
  const pipedLive = piped?.isLive ? piped : null;
  const invidiousLive = invidious?.isLive ? invidious : null;

  if (prefer === "piped") {
    if (pipedLive) return pipedLive;
    return invidiousLive;
  }
  if (prefer === "invidious") {
    if (invidiousLive) return invidiousLive;
    return pipedLive;
  }

  if (liveDetailHasHls(pipedLive)) return pipedLive;
  if (liveDetailHasHls(invidiousLive)) return invidiousLive;
  return pipedLive ?? invidiousLive;
}

/** Alternate upstream for a one-shot live playback fallback. */
export function alternateLiveUpstream(
  current: UpstreamPlaybackSource,
): UpstreamPlaybackSource | null {
  if (current === "piped") return "invidious";
  if (current === "invidious") return "piped";
  return null;
}

export function pickRicherPlaybackDetail(
  current: VideoDetail,
  candidate: VideoDetail,
): VideoDetail {
  const currentScore = playbackCatalogMaxHeightPx(current);
  const candidateScore = playbackCatalogMaxHeightPx(candidate);
  if (candidateScore > currentScore) return candidate;
  if (candidateScore === currentScore && hasSplitHdCapability(candidate)) {
    return candidate;
  }
  return current;
}

/**
 * Drop Piped LBRY / third-party progressive rows that are not proxied
 * `videoplayback` URLs — they clutter the quality menu and usually fail in
 * `<video>` (CORS / token lifetime).
 */
export function isPipedHostedProgressiveUrl(
  detail: VideoDetail,
  url: string,
): boolean {
  if (detail.sourceUsed !== "piped" && detail.sourceUsed !== "cache") {
    return true;
  }
  if (!url.trim()) return false;
  try {
    const u = new URL(url);
    if (u.pathname === "/videoplayback") return true;
    if (detail.mediaProxyBase) {
      try {
        if (u.origin === new URL(detail.mediaProxyBase).origin) return true;
      } catch {
        /* ignore */
      }
    }
    return isYoutubeFamilyHostname(u.hostname);
  } catch {
    return url.includes("/videoplayback");
  }
}
