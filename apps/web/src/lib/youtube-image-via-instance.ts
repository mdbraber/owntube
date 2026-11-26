/**
 * Google's image hosts (`*.ytimg.com`, `*.ggpht.com`,
 * `*.googleusercontent.com`): video stills, storyboards, channel avatars and
 * banners. A browser or TV that loads these itself tells Google what is on
 * screen, which a self-hosted front end exists to avoid.
 */
const GOOGLE_IMAGE_HOST = /(?:^|\.)(?:ytimg|ggpht|googleusercontent)\.com$/i;

/** The gateway's image route keys (`/media/img/<key>/<path>`), by Google host. */
const GATEWAY_IMAGE_KEY: Record<string, string> = {
  "i.ytimg.com": "yti",
  "i9.ytimg.com": "yti9",
  "yt3.ggpht.com": "yt3",
  "yt3.googleusercontent.com": "yt3gu",
};

/**
 * The same image, fetched through the gateway's image route (disk-cached, the
 * query kept: storyboards and some stills are signed); any other URL
 * unchanged. Google hosts the gateway does not serve fall back to
 * `i.ytimg.com`'s shape where that works, else stay as they are.
 *
 * `origin` is empty for the web (same-origin paths) and the server's base URL
 * for the TV app.
 */
export function youtubeImageViaInstance(url: string, origin = ""): string {
  let u: URL;
  try {
    u = new URL(url.startsWith("//") ? `https:${url}` : url);
  } catch {
    return url;
  }
  if (u.protocol !== "https:" || !GOOGLE_IMAGE_HOST.test(u.hostname)) {
    return url;
  }
  const host = u.hostname.toLowerCase();
  const key =
    GATEWAY_IMAGE_KEY[host] ??
    (/^i\d*\.ytimg\.com$/.test(host) ? "yti" : undefined) ??
    (/^yt\d+\.ggpht\.com$/.test(host) ? "yt3" : undefined);
  if (!key) return url;
  // A storyboard template keeps its `$M` sheet placeholder readable, so
  // `storyboardSheetUrl` can still fill it in after the rewrite.
  const path = u.pathname.replace(/%24M/g, "$M");
  return `${origin}/media/img/${key}${path}${u.search}`;
}

/** A video's still through the gateway (`hqdefault` exists for every video). */
export function videoStillUrl(
  videoId: string,
  still: "hqdefault" | "mqdefault" | "maxresdefault" | "hq720" = "hqdefault",
  origin = "",
): string {
  return `${origin}/media/img/yti/vi/${encodeURIComponent(videoId)}/${still}.jpg`;
}

/** A whole string that is a Google-hosted image URL. */
const GOOGLE_IMAGE_URL =
  /^(?:https:)?\/\/(?:[\w-]+\.)*(?:ytimg|ggpht|googleusercontent)\.com\//i;

/**
 * `value` with every string that is a Google-hosted image URL moved onto the
 * instance (see `youtubeImageViaInstance`), in plain objects and arrays at any
 * depth; anything else (dates, text that merely mentions such a URL) as is.
 * For data sent to a browser, so the page source names no Google URL.
 */
export function stripGoogleImageUrls<T>(value: T): T {
  if (typeof value === "string") {
    return (
      GOOGLE_IMAGE_URL.test(value) ? youtubeImageViaInstance(value) : value
    ) as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const s = stripGoogleImageUrls(v);
      if (s !== v) changed = true;
      return s;
    });
    return (changed ? out : value) as T;
  }
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const s = stripGoogleImageUrls(v);
      if (s !== v) changed = true;
      out[k] = s;
    }
    return (changed ? out : value) as T;
  }
  return value;
}

/** An image URL ready for the browser: Google-hosted ones through the gateway. */
export function browserImageUrl(
  raw: string | undefined | null,
): string | undefined {
  const url = raw?.trim();
  return url ? youtubeImageViaInstance(url) : undefined;
}
