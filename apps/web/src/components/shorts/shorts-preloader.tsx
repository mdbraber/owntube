"use client";

import { useEffect } from "react";
import { initialQualityIndexForPayload } from "@/components/player/player-quality";
import { isIosLikeBrowser } from "@/lib/ios-playback";
import { getMediaOrigin } from "@/lib/media-origin";
import { buildVideoPlayerPayloadFromDetail } from "@/lib/watch-player-payload";
import { trpc } from "@/trpc/react";

/** Bytes of a progressive next-short's start rung to warm (a few seconds). */
const PRELOAD_BYTES = 2_000_000;
/** Fallback warm size when a media playlist's first-segment range can't be read. */
const SEGMENT_WARM_FALLBACK_BYTES = 1_200_000;

/**
 * From a generated media playlist (byte-range fMP4), warm the init segment +
 * the opening media segments so hls.js can start decoding the instant it
 * attaches — no network round-trip for the first frames. All segments are byte
 * ranges into the same same-origin proxy URL (the EXT-X-MAP URI), so one ranged
 * GET covering the init + first ~2 segments does it.
 */
async function warmPlaylistSegments(
  playlistUrl: string,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(playlistUrl, { signal });
  if (!res.ok) return;
  const text = await res.text();
  const mediaUrl = text.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
  if (!mediaUrl) return;
  // Warm through the end of the 2nd media segment (enough to begin playback);
  // fall back to a flat size if the byte ranges aren't parseable.
  const ranges = [...text.matchAll(/#EXT-X-BYTERANGE:(\d+)@(\d+)/g)].slice(
    0,
    2,
  );
  let end = SEGMENT_WARM_FALLBACK_BYTES;
  const last = ranges[ranges.length - 1];
  if (last) {
    const len = Number(last[1]);
    const off = Number(last[2]);
    if (Number.isFinite(len) && Number.isFinite(off)) end = off + len;
  }
  await fetch(new URL(mediaUrl, playlistUrl).href, {
    headers: { Range: `bytes=0-${Math.max(0, end - 1)}` },
    signal,
  }).catch(() => {});
}

/** Warm the generated HLS end-to-end: master (triggers server-side manifest
 *  generation), the audio + lowest video media playlists, then their init +
 *  first segment bytes — so a swipe starts playback with no network wait. */
async function warmGeneratedHls(masterUrl: string, signal: AbortSignal) {
  try {
    const res = await fetch(masterUrl, { signal });
    if (!res.ok) return;
    const text = await res.text();
    const base = masterUrl.slice(0, masterUrl.lastIndexOf("/") + 1);
    const audioUri = text.match(/URI="([^"]*media\.m3u8[^"]*)"/)?.[1];
    // Rendition playlists follow each STREAM-INF, highest first, so the last is
    // the lowest rung — what hls.js is likeliest to start on.
    const videoUris = [...text.matchAll(/^(media\.m3u8[^\s"]*)$/gm)].map(
      (m) => m[1],
    );
    const lowest = videoUris[videoUris.length - 1];
    await Promise.all(
      [audioUri, lowest]
        .filter((u): u is string => Boolean(u))
        .map((u) => warmPlaylistSegments(base + u, signal).catch(() => {})),
    );
  } catch {
    /* best-effort */
  }
}

/**
 * Warms the *next* short's start stream so swiping to it begins playback with
 * little/no network wait. Reuses the already-prefetched detail (normally a cache
 * hit — no extra API call) and, for the generated HLS shorts take, pre-generates
 * the manifest + playlists; for Piped's progressive shorts, primes the opening
 * bytes of the start rung.
 *
 * Crucially it uses `fetch`, NOT a hidden `<video>`: a second decoding element
 * starves the active short's decoder on mobile and makes it flicker play/pause.
 * A byte/manifest fetch has no decoder, so it can't contend with playback. Only
 * mounted when the user's "preload next short" setting is on.
 */
export function ShortsPreloader({ videoId }: { videoId: string }) {
  const detailQuery = trpc.video.detail.useQuery(
    { videoId },
    { staleTime: 60_000 },
  );
  const detail = detailQuery.data;

  useEffect(() => {
    if (!detail || typeof window === "undefined") return;
    const built = buildVideoPlayerPayloadFromDetail(
      detail,
      getMediaOrigin(window.location.origin),
      window.location.host,
      { avoidSplitAudioVideo: isIosLikeBrowser() },
    );
    const payload = built.payload;
    if (!payload) return;

    const controller = new AbortController();
    if (payload.mode === "hls") {
      void warmGeneratedHls(
        new URL(payload.src, window.location.origin).href,
        controller.signal,
      );
    } else {
      const variants = payload.variants;
      const idx = initialQualityIndexForPayload(payload, "360p-muxed");
      const v = variants[idx] ?? variants[0];
      const src = v ? (v.t === "muxed" ? v.src : v.video) : null;
      if (src) {
        void fetch(src, {
          headers: { Range: `bytes=0-${PRELOAD_BYTES - 1}` },
          signal: controller.signal,
        }).catch(() => {});
      }
    }
    return () => controller.abort();
  }, [detail]);

  return null;
}
