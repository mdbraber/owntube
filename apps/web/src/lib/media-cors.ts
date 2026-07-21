/**
 * CORS for the media routes (/invidious, /dash, /hls, /captions, /yt-hls) now
 * that they're fetched cross-origin from the app's media-origin split (see
 * media-origin.ts). These routes never check session auth, so no
 * credentials are ever involved — a plain wildcard is CORS-spec-safe here
 * (Access-Control-Allow-Credentials is never set) and avoids depending on a
 * fragile "known app origins" allowlist.
 *
 * Content-Range/Content-Length aren't in the default CORS-exposed header set;
 * our byte-range chunking logic (and dash.js/hls.js) read them from the
 * response, so they must be explicitly exposed.
 */

const MEDIA_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers":
    "Content-Range, Content-Length, Accept-Ranges, Content-Type",
  // Every media GET carries a Range header, which isn't CORS-safelisted, so
  // it preflights. Without a cache lifetime the browser can't reuse that
  // preflight, paying an extra round trip per segment fetch — very visible
  // as multi-second scrub/seek latency. 24h is the CORS spec's own example
  // value; browsers clamp it to their own (shorter) cap regardless.
  "Access-Control-Max-Age": "86400",
} as const;

/** Adds CORS headers to a media response. */
export function withMediaCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(MEDIA_CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Preflight (OPTIONS) response for a media route. */
export function mediaCorsPreflight(): Response {
  return new Response(null, { status: 204, headers: MEDIA_CORS_HEADERS });
}
