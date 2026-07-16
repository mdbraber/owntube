/**
 * Canonical, YouTube-shaped app URLs.
 *
 * OwnTube uses YouTube's own URL scheme so you can take any youtube.com link,
 * swap the host for this app, and land on the same content:
 *   video    -> /watch?v=<id>
 *   playlist -> /playlist?list=<id>
 *   channel  -> /channel/<ucid>   (already a valid YouTube URL)
 *
 * These helpers are the single source of truth for building those links.
 * Legacy / alternate inbound shapes (/watch/<id>, /shorts/<id>, /embed/<id>,
 * /@handle, /c/<name>, /user/<name>, …) are redirected to these canonical
 * forms by `middleware.ts`.
 */

/** `/watch?v=<id>` (+ `&t=<seconds>` when a start time is given). */
export function watchHref(
  videoId: string,
  opts?: { t?: number | string | null },
): string {
  const params = new URLSearchParams({ v: videoId });
  const t = opts?.t;
  if (t !== undefined && t !== null && `${t}`.trim() !== "") {
    params.set("t", `${t}`);
  }
  return `/watch?${params.toString()}`;
}

/** `/playlist?list=<id>`. */
export function playlistHref(playlistId: string): string {
  return `/playlist?list=${encodeURIComponent(playlistId)}`;
}

/** `/channel/<ucid>` — already a valid YouTube URL, kept as the canonical form. */
export function channelHref(channelId: string): string {
  return `/channel/${encodeURIComponent(channelId)}`;
}

/** Extract the video id from a canonical `/watch?v=<id>` href (null if absent). */
export function videoIdFromWatchHref(href: string): string | null {
  const q = href.indexOf("?");
  if (q < 0) return null;
  return new URLSearchParams(href.slice(q + 1)).get("v");
}
