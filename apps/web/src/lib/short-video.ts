import type { UnifiedVideo } from "@/server/services/proxy.types";

/** YouTube Shorts max length; keeps the vertical feed from filling with long uploads. */
export const MAX_SHORT_DURATION_SECONDS = 60;

/** Slightly looser cap for upstream discovery when metadata is sparse or a few seconds over 60. */
export const DISCOVERY_SHORT_MAX_DURATION_SECONDS = 90;

/** Piped often sends `duration: -1` when length is unknown — treat as missing, not “zero seconds”. */
export function hasKnownPositiveDuration(
  seconds: number | undefined,
): seconds is number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0;
}

function titleHasShortsTag(title: string): boolean {
  return title.toLowerCase().includes("#shorts");
}

export function isStrictShortVideo(video: UnifiedVideo): boolean {
  if (video.isLive || video.isUpcoming) return false;
  const d = video.durationSeconds;
  if (hasKnownPositiveDuration(d)) {
    return d <= MAX_SHORT_DURATION_SECONDS;
  }
  return titleHasShortsTag(video.title);
}

export function pipedItemIsStrictShort(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const o = item as Record<string, unknown>;
  if (o.isShort === true) return true;
  const duration =
    typeof o.duration === "number" && Number.isFinite(o.duration)
      ? o.duration
      : undefined;
  if (hasKnownPositiveDuration(duration)) {
    return duration <= MAX_SHORT_DURATION_SECONDS;
  }
  const title = typeof o.title === "string" ? o.title : "";
  return titleHasShortsTag(title);
}

export function invidiousItemIsStrictShort(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const o = item as Record<string, unknown>;
  if (o.type === "shortVideo") return true;
  const length =
    typeof o.lengthSeconds === "number" && Number.isFinite(o.lengthSeconds)
      ? o.lengthSeconds
      : undefined;
  if (hasKnownPositiveDuration(length)) {
    return length <= MAX_SHORT_DURATION_SECONDS;
  }
  const title = typeof o.title === "string" ? o.title : "";
  return titleHasShortsTag(title);
}

export function isDiscoveryShortVideo(video: UnifiedVideo): boolean {
  if (video.isLive || video.isUpcoming) return false;
  if (isStrictShortVideo(video)) return true;
  const d = video.durationSeconds;
  if (hasKnownPositiveDuration(d)) {
    return d <= DISCOVERY_SHORT_MAX_DURATION_SECONDS;
  }
  return titleHasShortsTag(video.title);
}

export function pipedItemIsDiscoveryShort(item: unknown): boolean {
  if (pipedItemIsStrictShort(item)) return true;
  if (!item || typeof item !== "object") return false;
  const o = item as Record<string, unknown>;
  if (o.isShort === true) return true;
  const duration =
    typeof o.duration === "number" && Number.isFinite(o.duration)
      ? o.duration
      : undefined;
  if (hasKnownPositiveDuration(duration)) {
    return duration <= DISCOVERY_SHORT_MAX_DURATION_SECONDS;
  }
  const title = typeof o.title === "string" ? o.title : "";
  return titleHasShortsTag(title);
}

export function invidiousItemIsDiscoveryShort(item: unknown): boolean {
  if (invidiousItemIsStrictShort(item)) return true;
  if (!item || typeof item !== "object") return false;
  const o = item as Record<string, unknown>;
  if (o.type === "shortVideo") return true;
  const length =
    typeof o.lengthSeconds === "number" && Number.isFinite(o.lengthSeconds)
      ? o.lengthSeconds
      : undefined;
  if (hasKnownPositiveDuration(length)) {
    return length <= DISCOVERY_SHORT_MAX_DURATION_SECONDS;
  }
  const title = typeof o.title === "string" ? o.title : "";
  return titleHasShortsTag(title);
}

/** Upstream discovery row: strict short, or discovery-length with an explicit #shorts signal. */
export function isUpstreamDiscoveryShort(video: UnifiedVideo): boolean {
  if (isStrictShortVideo(video)) return true;
  if (!isDiscoveryShortVideo(video)) return false;
  return titleHasShortsTag(video.title);
}

/** Prefer strict shorts; fall back to tagged discovery only when the page has zero strict shorts. */
export function filterShortsFeedVideos(videos: UnifiedVideo[]): UnifiedVideo[] {
  const strict = videos.filter(isStrictShortVideo);
  if (strict.length > 0) return strict;
  const taggedDiscovery = videos.filter(isUpstreamDiscoveryShort);
  if (taggedDiscovery.length > 0) return taggedDiscovery;
  const discovery = videos.filter(isDiscoveryShortVideo);
  if (discovery.length > 0) return discovery;
  return [];
}
