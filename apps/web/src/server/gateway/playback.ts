import { playbackUrl, signPlayback } from "@owntube/contracts/signing";
import type { VideoPlayback } from "@/server/catalog/types";
import { gatewayConfig } from "@/server/gateway/config";
import type { SignedPlayback } from "@/server/gateway/map";

/** Playback URLs and caption URLs for a video page, signed with one expiry. */
export async function signedVideoPage(
  videoId: string,
  opts: { live: boolean },
): Promise<SignedPlayback> {
  const playback = await signedPlayback(videoId, opts);
  const { signingKey } = gatewayConfig();
  const sig = await signPlayback(signingKey, videoId, playback.expiresAt);
  return {
    playback,
    captions: (lang, auto) => {
      const q = new URLSearchParams({ lang });
      if (auto) q.set("auto", "1");
      q.set("exp", String(playback.expiresAt));
      q.set("sig", sig);
      return `/media/v/${encodeURIComponent(videoId)}/captions.vtt?${q}`;
    },
  };
}

/**
 * Signed gateway URLs for one video. The gateway picks the transport; the
 * player only chooses DASH or HLS. Live streams have no whole-file downloads.
 */
export async function signedPlayback(
  videoId: string,
  opts: { live: boolean; expiresAt?: number; now?: number },
): Promise<VideoPlayback> {
  const { signingKey, playbackTtlSec } = gatewayConfig();
  const expiresAt =
    opts.expiresAt ??
    Math.floor((opts.now ?? Date.now()) / 1000) + playbackTtlSec;
  const sign = (file: Parameters<typeof playbackUrl>[2]) =>
    playbackUrl(signingKey, videoId, file, { expiresAt });
  const [dash, hls] = await Promise.all([
    sign("manifest.mpd"),
    sign("master.m3u8"),
  ]);
  if (opts.live) return { dash, hls, expiresAt };
  const [audio, video] = await Promise.all([
    sign("audio.m4a"),
    sign("video.mp4"),
  ]);
  return { dash, hls, audio, video, expiresAt };
}

const DAY_SEC = 86_400;
/** Enclosure URLs change at most once per this window, so feeds stay stable between publishes. */
const ENCLOSURE_WINDOW_SEC = 30 * DAY_SEC;
/** Podcast apps fetch episodes long after a feed is read. */
const ENCLOSURE_VALIDITY_SEC = 365 * DAY_SEC;

/**
 * Whole-file URLs for podcast feeds: valid for a year, and the same for a
 * whole 30-day window so republishing a feed does not change its items.
 * Absolute on `appOrigin` (podcast apps resolve nothing).
 */
export async function signedEnclosures(
  videoId: string,
  appOrigin: string,
  now: number = Date.now(),
): Promise<{ enclosureAudio: string; enclosureVideo: string }> {
  const nowSec = Math.floor(now / 1000);
  const expiresAt =
    Math.ceil(nowSec / ENCLOSURE_WINDOW_SEC) * ENCLOSURE_WINDOW_SEC +
    ENCLOSURE_VALIDITY_SEC;
  const p = await signedPlayback(videoId, { live: false, expiresAt });
  const absolute = (path: string | undefined) =>
    new URL(path ?? "", appOrigin).toString();
  return {
    enclosureAudio: absolute(p.audio),
    enclosureVideo: absolute(p.video),
  };
}
