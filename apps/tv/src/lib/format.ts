import { PixelRatio } from "react-native";
import { baseUrl } from "@/lib/config";

/** mm:ss / h:mm:ss for durations and playback time. */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

export function formatViews(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count)) return null;
  if (count >= 1_000_000) return `${Math.floor(count / 1_000_000)}M views`;
  if (count >= 1_000) return `${Math.floor(count / 1_000)}K views`;
  return `${Math.floor(count)} views`;
}

export function formatCompactCount(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count) || count < 0) return null;
  if (count >= 1_000_000) {
    const value = count / 1_000_000;
    return value >= 10
      ? `${Math.floor(value)}M`
      : `${value.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (count >= 1_000) {
    const value = count / 1_000;
    return value >= 10
      ? `${Math.floor(value)}K`
      : `${value.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(Math.floor(count));
}

export function formatSubscribersLabel(
  count: number | undefined,
): string | null {
  const compactCount = formatCompactCount(count);
  if (!compactCount) return null;
  return `${compactCount} subscriber${Math.floor(count ?? 0) === 1 ? "" : "s"}`;
}

export function formatThumbnailBadge({
  durationSeconds,
  isLive,
  isUpcoming,
}: {
  durationSeconds?: number;
  isLive?: boolean;
  isUpcoming?: boolean;
}): string | null {
  if (isUpcoming) return "Upcoming";
  if (isLive) return "LIVE";
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds)) {
    return null;
  }
  return formatTime(durationSeconds);
}

function formatRelativeFromNow(secondsSinceEpoch: number): string | null {
  if (!Number.isFinite(secondsSinceEpoch) || secondsSinceEpoch <= 0)
    return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const delta = Math.max(0, nowSeconds - Math.floor(secondsSinceEpoch));

  if (delta < 60) return "just now";
  if (delta < 3600) {
    const minutes = Math.floor(delta / 60);
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  }
  if (delta < 86_400) {
    const hours = Math.floor(delta / 3600);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  }
  if (delta < 2_592_000) {
    const days = Math.floor(delta / 86_400);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }
  if (delta < 31_536_000) {
    const months = Math.floor(delta / 2_592_000);
    return `${months} month${months > 1 ? "s" : ""} ago`;
  }
  const years = Math.floor(delta / 31_536_000);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

export function formatPublishedLabel(
  publishedText: string | undefined,
  publishedAt?: number,
): string | null {
  if (typeof publishedAt === "number" && Number.isFinite(publishedAt)) {
    const timestampLabel = formatRelativeFromNow(publishedAt);
    if (timestampLabel) return timestampLabel;
  }
  const text = publishedText?.trim();
  if (!text) return null;

  const secondsMatch = /^(\d{9,13})s$/i.exec(text);
  if (secondsMatch) {
    let seconds = Number.parseInt(secondsMatch[1] ?? "", 10);
    if (seconds > 1_000_000_000_000) seconds = Math.floor(seconds / 1000);
    const unixLabel = formatRelativeFromNow(seconds);
    if (unixLabel) return unixLabel;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const milliseconds = Date.parse(text);
    if (Number.isFinite(milliseconds)) {
      const isoLabel = formatRelativeFromNow(Math.floor(milliseconds / 1000));
      if (isoLabel) return isoLabel;
    }
  }

  return text.length > 56 ? `${text.slice(0, 55)}...` : text;
}

export function channelInitial(name: string | undefined): string {
  const first = name?.trim().charAt(0);
  return first ? first.toUpperCase() : "o";
}

/**
 * A video still by id, from this instance's `/image` proxy. The TV never asks
 * YouTube for an image itself: that would tell Google what is on screen,
 * straight from the living room — the one thing a self-hosted front end exists
 * to avoid. The proxy caches every still on disk, and when the asked-for still
 * is missing it answers with the next one down (see `VI_THUMB_FALLBACKS` in
 * the web app's upstream-proxy.ts), so callers needn't keep a fallback chain.
 */
export function stillUrl(videoId: string, name: string): string {
  return `${baseUrl()}/image/vi/${encodeURIComponent(videoId)}/${name}`;
}

/**
 * A still on YouTube's CDN (any `*.ytimg.com` host, `/vi/` or `/vi_webp/`),
 * with its query: video id, still name. A regex, not `URL`, so it doesn't
 * depend on how much of `URL` the React Native runtime implements.
 */
const YTIMG_STILL_RE =
  /^https?:\/\/(?:[\w-]+\.)*ytimg\.com\/vi(?:_webp)?\/([\w-]+)\/([\w-]+)\.(?:jpe?g|webp)(?:[?#].*)?$/i;

/**
 * A still URL from API data, moved onto this instance when it points at
 * YouTube (see `stillUrl`). YouTube's own query (`sqp=…`) is dropped — the
 * proxy needs no signature — and `vi_webp` stills are asked for as JPEG, the
 * name the proxy's fallback chain knows. Anything else (instance URLs, signed
 * or not) passes through unchanged.
 */
export function viaInstance(url: string): string {
  const m = YTIMG_STILL_RE.exec(url);
  return m ? stillUrl(m[1], `${m[2]}.jpg`) : url;
}

/** An unsigned `/vi/<id>/<still>` path on YouTube's CDN or an Invidious instance. */
const LARGE_STILL_RE =
  /^(\/vi\/[^/]+\/)(?:maxres|maxresdefault|hq720)\.jpe?g$/i;

/**
 * Feed rows arrive with the 1280x720 `maxres` still, chosen for the web's
 * large cards. A TV card is 264x148 dp, and an Invidious instance takes one
 * to two seconds to answer `maxres.jpg` every time (it fetches and re-encodes
 * it per request), against ~30 ms for `hqdefault.jpg` — which is why a fresh
 * row sat grey for a beat. So cards ask for `hqdefault` instead; its 4:3
 * letterbox bars fall outside the card's 16:9 "cover" crop. Signed instance
 * URLs (`?host=…&rs=…`) pair the tier with the signature and stay as they are.
 */
function cardTier(url: string): string {
  try {
    const u = new URL(url);
    if (u.search) return url;
    const m = LARGE_STILL_RE.exec(u.pathname);
    if (!m) return url;
    u.pathname = `${m[1]}hqdefault.jpg`;
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * A video's thumbnail for a card (see `cardTier`), never straight from
 * YouTube: the row's own still, or this instance's by id when the row carries
 * none (history rows, for one, leave it to the client — as on the web).
 */
export function videoThumbnailUrl(video: {
  videoId: string;
  thumbnailUrl?: string;
}): string {
  const url = video.thumbnailUrl;
  return url
    ? viaInstance(cardTier(url))
    : stillUrl(video.videoId, "hqdefault.jpg");
}

/**
 * Stills for the full-width hero, sharpest first. The row's own thumbnail is
 * card-sized (blurry at 1080p), so ask for the 1280x720 `hq720` by id first.
 * When a video has none the proxy answers with `maxresdefault`, and failing
 * that `hqdefault`, so this one request already covers the large stills; the
 * row's own is left for when the instance can't serve the id at all.
 */
export function heroThumbnailUrls(video: {
  videoId: string;
  thumbnailUrl?: string;
}): string[] {
  const urls = [stillUrl(video.videoId, "hq720.jpg"), videoThumbnailUrl(video)];
  return urls.filter((url, index) => urls.indexOf(url) === index);
}

/**
 * Upstream comment text arrives as HTML (links for timestamps, entities).
 * The TV shows it as plain text: line breaks kept, tags dropped, entities
 * decoded.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * A channel avatar URL asking for the size it is drawn at, fetched through
 * this instance.
 *
 * Size: feeds hand out Google's 512px avatars (`…=s512-c-k-…`) for circles of
 * 28-96dp; decoded that is 1 MB each, and Subscriptions keeps an avatar per
 * subscribed channel attached. With 177 channels the textures overran the GPU
 * cache and every frame re-uploaded them: 200+ ms frames on a KPN box. Google
 * serves any `=sN`, so ask for the drawn size in pixels.
 *
 * Through the instance: like video stills (see `stillUrl`), the TV never asks
 * Google for an avatar itself. The server's `/channel-avatar` fetches it and
 * keeps it in its disk cache. Other URLs (instance-hosted) pass through.
 */
export function sizedAvatarUrl(url: string, sizeDp: number): string {
  const px = Math.ceil(sizeDp * PixelRatio.get());
  const absolute = url.startsWith("//") ? `https:${url}` : url;
  const sized = absolute.replace(
    /^(https:\/\/(?:yt\d\.)?(?:googleusercontent|ggpht)\.com\/[^=?#]+)=s\d+/,
    `$1=s${px}`,
  );
  return GOOGLE_AVATAR_RE.test(sized)
    ? `${baseUrl()}/channel-avatar?url=${encodeURIComponent(sized)}`
    : sized;
}

/** An avatar on Google's image hosts (what `/channel-avatar` accepts). */
const GOOGLE_AVATAR_RE =
  /^https:\/\/(?:[\w-]+\.)*(?:googleusercontent|ggpht)\.com\//i;
