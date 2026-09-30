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

/** An unsigned `/vi/<id>/<still>` path on YouTube's CDN or an Invidious instance. */
const LARGE_STILL_RE =
  /^(\/vi\/[^/]+\/)(?:maxres|maxresdefault|hq720)\.jpe?g$/i;

/** A video still on YouTube's CDN (any `*.ytimg.com` host), query ignored. */
const YTIMG_STILL_RE =
  /^https?:\/\/(?:[\w-]+\.)*ytimg\.com\/vi\/([\w-]{11})\/([\w-]+\.jpe?g)(?:[?#].*)?$/i;

/**
 * The same still, fetched through this instance's `/image` proxy instead of
 * from YouTube; any other URL passes through unchanged.
 *
 * The TV never asks YouTube for an image itself: that would tell Google what
 * is on screen, straight from the living room, which is the one thing a
 * self-hosted front end exists to avoid. It costs nothing in reliability —
 * `/image` resolves a missing rung server-side (asked for `maxresdefault` on a
 * video without one, it answers with `hq720`'s bytes) and caches every still
 * on disk. YouTube's own query (`sqp=…`) is dropped: the proxy signs nothing.
 */
export function viaInstance(url: string): string {
  const m = YTIMG_STILL_RE.exec(url);
  return m ? `${baseUrl()}/image/vi/${m[1]}/${m[2]}` : url;
}

/**
 * A video's thumbnail for a card, falling back to YouTube's own still by id
 * when the row carries none (history rows, for one, leave it to the client —
 * as on the web).
 *
 * Feed rows arrive with the 1280x720 `maxres` still, chosen for the web's
 * large cards. A TV card is 264x148 dp, and an Invidious instance takes one
 * to two seconds to answer `maxres.jpg` every time (it fetches and re-encodes
 * it per request), against ~30 ms for `hqdefault.jpg` — which is why a fresh
 * row sat grey for a beat. So cards ask for `hqdefault` instead; its 4:3
 * letterbox bars fall outside the card's 16:9 "cover" crop. Signed instance
 * URLs (`?host=…&rs=…`) pair the tier with the signature and stay as they are.
 */
function cardStillUrl(video: {
  videoId: string;
  thumbnailUrl?: string;
}): string {
  const url = video.thumbnailUrl;
  if (!url) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg`;
  }
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

/** A video's card thumbnail (see `cardStillUrl`), never straight from YouTube. */
export function videoThumbnailUrl(video: {
  videoId: string;
  thumbnailUrl?: string;
}): string {
  return viaInstance(cardStillUrl(video));
}

/**
 * Stills for the full-width hero, sharpest first. The row's own thumbnail is
 * card-sized (blurry at 1080p), so try YouTube's larger stills by id, then
 * fall back to it: `maxresdefault` only exists for HD uploads and `hq720`
 * isn't universal either — both answer 404 when missing.
 */
export function heroThumbnailUrls(video: {
  videoId: string;
  thumbnailUrl?: string;
}): string[] {
  const id = encodeURIComponent(video.videoId);
  const urls = [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    videoThumbnailUrl(video),
  ].map(viaInstance);
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
 * A channel avatar URL asking for the size it is drawn at. Feeds hand out
 * Google's 512px avatars (`…=s512-c-k-…`) for circles of 28-96dp; decoded
 * that is 1 MB each, and Subscriptions keeps an avatar per subscribed channel
 * attached. With 177 channels the textures overran the GPU cache and every
 * frame re-uploaded them: 200+ ms frames on a KPN box. Google serves any
 * `=sN`, so ask for the drawn size in pixels. Other URLs pass through.
 */
export function sizedAvatarUrl(url: string, sizeDp: number): string {
  const px = Math.ceil(sizeDp * PixelRatio.get());
  return url.replace(
    /^(https:\/\/(?:yt\d\.)?(?:googleusercontent|ggpht)\.com\/[^=?#]+)=s\d+/,
    `$1=s${px}`,
  );
}
