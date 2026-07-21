/**
 * Origin that video/manifest/caption proxy URLs are built against — kept
 * separate from the page's own origin so a Safari HTTP/2 bug (resetting one
 * media stream can kill the whole shared connection, taking unrelated API
 * calls like history.upsertEvent down with it) can't touch API traffic:
 * different origin means a different browser connection. Falls back to
 * `appOrigin` (same-origin, today's behavior) wherever
 * NEXT_PUBLIC_MEDIA_BASE_URL isn't configured.
 */
export function getMediaOrigin(appOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_MEDIA_BASE_URL?.trim().replace(
    /\/+$/,
    "",
  );
  return configured || appOrigin;
}

/**
 * Resolves a possibly-relative OwnTube-own media path (e.g. the synthesized
 * `/hls/<id>/master.m3u8` / `/dash/<id>/manifest.mpd`) to an absolute URL on
 * the media origin. Already-absolute URLs pass through unchanged.
 */
export function toMediaOriginUrl(pathOrUrl: string, appOrigin: string): string {
  if (!pathOrUrl) return pathOrUrl;
  try {
    return new URL(pathOrUrl, getMediaOrigin(appOrigin)).toString();
  } catch {
    return pathOrUrl;
  }
}
