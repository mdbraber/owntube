import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Playback URLs are signed by whoever may hand them out (the web app, after
 * its own auth) and checked here, so the gateway is not an open YouTube
 * proxy. A signature covers the video and an expiry; in a query string, which
 * survives TV and cast players that cannot send headers.
 */
export function signPlayback(
  key: string,
  videoId: string,
  expiresAt: number,
): string {
  return createHmac("sha256", key)
    .update(`${videoId}.${expiresAt}`)
    .digest("base64url");
}

export function verifyPlayback(
  key: string,
  videoId: string,
  exp: string | undefined,
  sig: string | undefined,
  now: number = Date.now(),
): boolean {
  const expiresAt = Number(exp);
  if (!sig || !Number.isInteger(expiresAt) || expiresAt * 1000 < now)
    return false;
  const expected = Buffer.from(signPlayback(key, videoId, expiresAt));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
