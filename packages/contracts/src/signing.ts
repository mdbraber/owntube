/**
 * Playback URLs carry an HMAC over the video id and an expiry, made by
 * whoever may hand them out (the web app, after its own auth) and checked by
 * the gateway. Web Crypto, so this runs in Node, browsers and workers alike;
 * the gateway's node:crypto check produces the same signature.
 */
export async function signPlayback(
  key: string,
  videoId: string,
  expiresAt: number,
): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", k, enc.encode(`${videoId}.${expiresAt}`)),
  );
  let binary = "";
  for (const b of mac) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The kinds of playback URL the gateway serves for a video. */
export type PlaybackFile =
  | "manifest.mpd"
  | "master.m3u8"
  | "audio.m4a"
  | "video.mp4";

/** A signed gateway playback URL (path only: same host, `/media/*` routed to the gateway). */
export async function playbackUrl(
  key: string,
  videoId: string,
  file: PlaybackFile,
  options: { expiresAt: number; query?: Record<string, string> },
): Promise<string> {
  const params = new URLSearchParams(options.query);
  params.set("exp", String(options.expiresAt));
  params.set("sig", await signPlayback(key, videoId, options.expiresAt));
  return `/media/v/${encodeURIComponent(videoId)}/${file}?${params}`;
}
