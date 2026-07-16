"use client";

import { useMemo } from "react";
import { initialQualityIndexForPayload } from "@/components/player/player-quality";
import { isIosLikeBrowser } from "@/lib/ios-playback";
import { buildVideoPlayerPayloadFromDetail } from "@/lib/watch-player-payload";
import { trpc } from "@/trpc/react";

/**
 * Invisibly buffers the *next* short's start stream so swiping to it begins
 * playback with no network wait. It reuses the already-prefetched detail (the
 * feed prefetches detail ±ahead, so this is normally a cache hit — no extra API
 * call), extracts the exact low muxed rung the player starts on, and lets a
 * hidden `<video preload="auto">` warm the HTTP cache the real player then
 * reuses. Only mounted when the user's "preload next short" setting is on.
 *
 * HLS starts are skipped: warming a manifest's segments isn't a cheap single
 * request, and shorts almost always resolve to a muxed progressive start.
 */
export function ShortsPreloader({ videoId }: { videoId: string }) {
  const detailQuery = trpc.video.detail.useQuery(
    { videoId },
    { staleTime: 60_000 },
  );

  const src = useMemo(() => {
    if (!detailQuery.data || typeof window === "undefined") return null;
    const built = buildVideoPlayerPayloadFromDetail(
      detailQuery.data,
      window.location.origin,
      window.location.host,
      { avoidSplitAudioVideo: isIosLikeBrowser() },
    );
    if (built.payload?.mode !== "progressive") return null;
    const variants = built.payload.variants;
    // Same rung the shorts player starts on (lowest muxed) → the bytes we warm
    // are the bytes it will actually request.
    const idx = initialQualityIndexForPayload(built.payload, "360p-muxed");
    const v = variants[idx] ?? variants[0];
    if (!v) return null;
    return v.t === "muxed" ? v.src : v.video;
  }, [detailQuery.data]);

  if (!src) return null;
  return (
    // biome-ignore lint/a11y/useMediaCaption: silent, off-screen cache-warmer.
    <video
      key={src}
      src={src}
      muted
      playsInline
      preload="auto"
      aria-hidden
      tabIndex={-1}
      className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
    />
  );
}
