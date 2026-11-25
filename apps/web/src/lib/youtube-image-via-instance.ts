/**
 * Google's image hosts (`*.ytimg.com`, `*.ggpht.com`,
 * `*.googleusercontent.com`): video stills, storyboards, channel avatars and
 * banners. A browser or TV that loads these itself tells Google what is on
 * screen, which a self-hosted front end exists to avoid.
 */
const GOOGLE_IMAGE_HOST = /(?:^|\.)(?:ytimg|ggpht|googleusercontent)\.com$/i;

/** `/vi/<id>/<still>.jpg` (or `/vi_webp/…/.webp`) on ytimg. */
const STILL_PATH = /^\/vi(?:_webp)?\/([\w-]+)\/([\w-]+)\.(?:jpe?g|webp)$/i;

/**
 * The same image, fetched through this instance; any other URL unchanged.
 *
 * - Video stills go to `/image/vi/<id>/<still>.jpg`: the server's thumbnail
 *   proxy, with its disk cache and its fallback to the next still size when
 *   one is missing. YouTube's query (`sqp=…`) is dropped; nothing is signed.
 * - Everything else on Google's hosts (avatars, banners, storyboard sheets,
 *   whose `sigh=` signature must stay) goes to `/channel-avatar?url=…`, which
 *   accepts exactly these hosts and caches what it fetches.
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
  const still = /ytimg\.com$/i.test(u.hostname)
    ? STILL_PATH.exec(u.pathname)
    : null;
  if (still) {
    return `${origin}/image/vi/${still[1]}/${still[2]}.jpg`;
  }
  return `${origin}/channel-avatar?url=${encodeURIComponent(u.toString())}`;
}
