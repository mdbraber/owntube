import { videoStillUrl } from "@/lib/youtube-image-via-instance";

/**
 * Picking and stepping down video stills. Every still is the gateway's
 * (`/media/img/yti/vi/<id>/<name>.jpg`): unsigned ones by name, or the signed
 * ones a video's thumbnail list carries (`?sqp=…&rs=…`), whose name is tied
 * to their signature and so never changed.
 */

/** A still the gateway serves, unsigned or signed: video id and file name. */
const STILL_PATH =
  /\/media\/img\/yti\d?\/vi(?:_webp)?\/([\w-]+)\/([\w-]+\.(?:jpe?g|webp))$/i;

/** Stills smaller than maxres, which a card may upgrade (unsigned only). */
const LOWER_TIER = /^(hq720|hqdefault|mqdefault|sddefault|default)\./i;

/** Vertical stills a Short has. */
const SHORT_STILL = /^(oar2|oardefault|oar1|oar3)\./i;

/** The next smaller still when one is missing (not every video has maxres). */
const NEXT_TIER: Record<string, string> = {
  maxresdefault: "hqdefault",
  hq720: "hqdefault",
  hqdefault: "mqdefault",
  mqdefault: "sddefault",
  sddefault: "default",
  oar2: "oardefault",
  oardefault: "maxresdefault",
};

const MAX_FALLBACK_STEPS = 5;

type Still = { videoId: string; name: string; signed: boolean };

function parseStill(url: string): Still | undefined {
  let u: URL;
  try {
    u = new URL(url, "http://localhost");
  } catch {
    return undefined;
  }
  const m = STILL_PATH.exec(u.pathname);
  if (!m?.[1] || !m[2]) return undefined;
  return { videoId: m[1], name: m[2], signed: u.search.length > 0 };
}

/** maxres where it can be asked for (an unsigned lower still), else as is. */
export function preferHighResVideoThumbnailUrl(
  url: string | undefined,
  videoId?: string,
): string | undefined {
  if (!url) return videoId ? videoStillUrl(videoId, "hqdefault") : undefined;
  const still = parseStill(url);
  if (!still || still.signed || !LOWER_TIER.test(still.name)) return url;
  return videoStillUrl(still.videoId, "maxresdefault");
}

/** Large hero banners: maxres by video id. */
export function preferHeroVideoThumbnailUrl(
  url: string | undefined,
  videoId?: string,
): string | undefined {
  return videoId
    ? videoStillUrl(videoId, "maxresdefault")
    : preferHighResVideoThumbnailUrl(url);
}

/** Shorts: the vertical still, unless the row already has one or a signed still. */
export function preferShortVideoThumbnailUrl(
  url: string | undefined,
  videoId?: string,
): string | undefined {
  const still = url ? parseStill(url) : undefined;
  if (url && (!still || still.signed || SHORT_STILL.test(still.name)))
    return url;
  const id = still?.videoId ?? videoId;
  return id
    ? `/media/img/yti/vi/${encodeURIComponent(id)}/oar2.jpg`
    : undefined;
}

/** The still to try when `url` failed to load, or undefined at the end of the chain. */
export function nextFallbackVideoThumbnailUrl(url: string): string | undefined {
  const still = parseStill(url);
  if (!still) return undefined;
  const tier = still.name.split(".")[0]?.toLowerCase() ?? "";
  const next = NEXT_TIER[tier];
  return next
    ? `/media/img/yti/vi/${encodeURIComponent(still.videoId)}/${next}.jpg`
    : undefined;
}

/** `<img onError>`: step down to the next still, a few times at most. */
export function applyVideoThumbnailImgError(el: HTMLImageElement): void {
  const steps = Number.parseInt(el.dataset.fallbackSteps ?? "0", 10);
  if (steps >= MAX_FALLBACK_STEPS) return;
  const next = nextFallbackVideoThumbnailUrl(el.src);
  if (!next) return;
  el.dataset.fallbackSteps = String(steps + 1);
  el.src = next;
}
