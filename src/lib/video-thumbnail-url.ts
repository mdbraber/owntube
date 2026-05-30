const LOWER_TIER_THUMB =
  /^(hq720|hqdefault|mqdefault|sddefault|default)\.(jpe?g|webp)$/i;

const THUMB_FILENAME =
  /^(maxresdefault|hq720|hqdefault|mqdefault|sddefault|default)\.(jpe?g|webp)$/i;

const INSTANCE_THUMB_PATH = /\/(?:vi|bp)\/([^/]+)\/[^/]+$/i;

const NEXT_THUMB_TIER: Record<string, string> = {
  maxresdefault: "hqdefault",
  hq720: "hqdefault",
  hqdefault: "mqdefault",
  mqdefault: "sddefault",
  sddefault: "default",
};

const MAX_THUMBNAIL_FALLBACK_STEPS = 5;

function isYoutubeThumbHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "i.ytimg.com" || h.endsWith(".ytimg.com");
}

function isInstanceVideoThumbPath(pathname: string): boolean {
  return INSTANCE_THUMB_PATH.test(pathname);
}

function extractVideoIdFromThumbPath(pathname: string): string | undefined {
  return INSTANCE_THUMB_PATH.exec(pathname)?.[1];
}

function youtubeThumbUrl(videoId: string, filename: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${filename}`;
}

/** Piped `/vi/{id}/{file}?host=…&rs=…` — tier and signature must stay paired. */
function isSignedInstanceThumbUrl(u: URL): boolean {
  return u.search.length > 0 && isInstanceVideoThumbPath(u.pathname);
}

/** True when the still name is below maxres (Piped lists often ship hq720). */
export function isLowerTierVideoThumbnailFilename(filename: string): boolean {
  const base = filename.split("?")[0]?.trim() ?? "";
  return LOWER_TIER_THUMB.test(base);
}

function nextThumbFilename(filename: string): string | undefined {
  const match = filename.match(THUMB_FILENAME);
  if (!match) return undefined;
  const tier = match[1]?.toLowerCase() ?? "";
  const ext = (match[2] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
  const nextTier = NEXT_THUMB_TIER[tier];
  if (!nextTier) return undefined;
  const nextExt =
    nextTier === "default" ? "jpg" : ext === "webp" ? "webp" : "jpg";
  return `${nextTier}.${nextExt}`;
}

/**
 * Prefer maxres when safe (direct YouTube CDN). Keeps signed Piped/Invidious
 * proxy URLs unchanged — upgrading the filename invalidates `rs` signatures.
 */
export function preferHighResVideoThumbnailUrl(
  url: string | undefined,
  videoId?: string,
): string | undefined {
  if (!url) {
    if (!videoId) return undefined;
    return youtubeThumbUrl(videoId, "hqdefault.jpg");
  }
  try {
    const u = new URL(url);
    if (isSignedInstanceThumbUrl(u)) return url;
    const parts = u.pathname.split("/");
    const fn = parts[parts.length - 1] ?? "";
    if (!fn || !isLowerTierVideoThumbnailFilename(fn)) return url;
    if (!isYoutubeThumbHost(u.hostname)) return url;
    const isWebp =
      fn.toLowerCase().endsWith(".webp") || u.pathname.includes("/bp/");
    parts[parts.length - 1] = isWebp
      ? "maxresdefault.webp"
      : "maxresdefault.jpg";
    u.pathname = parts.join("/");
    return u.toString();
  } catch {
    return url;
  }
}

/** Client `<img onError>` step down when maxres is missing for a video. */
export function nextFallbackVideoThumbnailUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    const fn = parts[parts.length - 1] ?? "";
    const nextFn = nextThumbFilename(fn);
    if (!nextFn) return undefined;

    const thumbVideoId = extractVideoIdFromThumbPath(u.pathname);

    if (
      thumbVideoId &&
      (isSignedInstanceThumbUrl(u) || isYoutubeThumbHost(u.hostname))
    ) {
      return youtubeThumbUrl(thumbVideoId, nextFn);
    }

    if (thumbVideoId && isInstanceVideoThumbPath(u.pathname)) {
      parts[parts.length - 1] = nextFn;
      u.pathname = parts.join("/");
      u.search = "";
      return u.toString();
    }

    u.pathname = u.pathname.replace(/\/[^/]+$/, `/${nextFn}`);
    return u.toString();
  } catch {
    return undefined;
  }
}

export function applyVideoThumbnailImgError(el: HTMLImageElement): void {
  const steps = Number.parseInt(el.dataset.fallbackSteps ?? "0", 10);
  if (steps >= MAX_THUMBNAIL_FALLBACK_STEPS) return;
  const next = nextFallbackVideoThumbnailUrl(el.src);
  if (!next || next === el.src) return;
  el.dataset.fallbackSteps = String(steps + 1);
  el.src = next;
}
