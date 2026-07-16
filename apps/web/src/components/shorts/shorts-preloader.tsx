"use client";

import { useEffect } from "react";
import { initialQualityIndexForPayload } from "@/components/player/player-quality";
import { isIosLikeBrowser } from "@/lib/ios-playback";
import { buildVideoPlayerPayloadFromDetail } from "@/lib/watch-player-payload";
import { trpc } from "@/trpc/react";

/** Bytes of a progressive next-short's start rung to warm (a few seconds). */
const PRELOAD_BYTES = 2_000_000;

/** Warm the generated HLS: fetch the master (triggers server-side manifest
 *  generation — the dominant ~1s cost as it re-fetches the source streams),
 *  then the audio + lowest video media playlists so hls.js has everything ready
 *  the instant the slide mounts. Segment bytes stream fast once generated. */
async function warmGeneratedHls(masterUrl: string, signal: AbortSignal) {
  try {
    const res = await fetch(masterUrl, { signal });
    if (!res.ok) return;
    const text = await res.text();
    const base = masterUrl.slice(0, masterUrl.lastIndexOf("/") + 1);
    const audioUri = text.match(/URI="([^"]*media\.m3u8[^"]*)"/)?.[1];
    // Rendition playlists are listed after each STREAM-INF, highest first, so
    // the last one is the lowest rung — what hls.js is likeliest to start on.
    const videoUris = [...text.matchAll(/^(media\.m3u8[^\s"]*)$/gm)].map(
      (m) => m[1],
    );
    const lowest = videoUris[videoUris.length - 1];
    await Promise.all(
      [audioUri, lowest]
        .filter((u): u is string => Boolean(u))
        .map((u) => fetch(base + u, { signal }).catch(() => {})),
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
      window.location.origin,
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
