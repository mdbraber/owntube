"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoActionSurface } from "@/components/videos/video-action-registry";
import { VideoCardDurationBadge } from "@/components/videos/video-card-duration-badge";
import { useWatchProgress } from "@/components/videos/video-membership-context";
import { VideoStatusPills } from "@/components/videos/video-status-pills";
import { VideoWatchProgress } from "@/components/videos/video-watch-progress";
import { hlsVodConfig } from "@/lib/hls-config";
import { cn } from "@/lib/utils";
import {
  applyVideoThumbnailImgError,
  preferHighResVideoThumbnailUrl,
} from "@/lib/video-thumbnail-url";
import { COMPLETION_RATIO } from "@/lib/watch-event";
import { previewStreamFromDetail } from "@/lib/watch-playback";
import { browserImageUrl } from "@/lib/youtube-image-via-instance";
import { trpc } from "@/trpc/react";

const DWELL_MS = 400;
const PREVIEW_VOLUME = 0.42;
/** Sticky preview-sound preference — unmute once, stays unmuted. */
const PREVIEW_MUTED_KEY = "ot:preview-muted";

function readPreviewMutedPref(): boolean {
  try {
    return localStorage.getItem(PREVIEW_MUTED_KEY) !== "0";
  } catch {
    return true;
  }
}

function writePreviewMutedPref(muted: boolean): void {
  try {
    localStorage.setItem(PREVIEW_MUTED_KEY, muted ? "1" : "0");
  } catch {
    // storage unavailable
  }
}

type VideoCardThumbnailInteractiveProps = {
  href: string;
  videoId: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  isLive?: boolean;
  isUpcoming?: boolean;
  /** Skip hover preview (live streams use HLS). */
  disableHoverPreview?: boolean;
  /** Outer card uses `group` for hover scale on the image */
  thumbClassName: string;
  imgClassName: string;
  surface?: VideoActionSurface;
};

function teardownMedia(
  video: HTMLVideoElement | null,
  hlsDestroy: (() => void) | null,
) {
  hlsDestroy?.();
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

export function VideoCardThumbnailInteractive({
  href,
  videoId,
  thumbnailUrl,
  durationSeconds,
  isLive,
  isUpcoming,
  disableHoverPreview = false,
  thumbClassName,
  imgClassName,
  surface,
}: VideoCardThumbnailInteractiveProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsDestroyRef = useRef<(() => void) | null>(null);
  const previewActiveRef = useRef(false);

  const [pointerInside, setPointerInside] = useState(false);
  const [dwellOk, setDwellOk] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(true);
  const previewMutedRef = useRef(previewMuted);
  previewMutedRef.current = previewMuted;
  const pointerInsideRef = useRef(pointerInside);
  pointerInsideRef.current = pointerInside;
  /** Live preview position for the thumbnail scrubber. */
  const [previewFraction, setPreviewFraction] = useState<number | null>(null);
  /**
   * The thumbnail only swaps out once the preview has a painted frame.
   * Keying the crossfade on `playback` alone blanked the card grey while the
   * stream was still connecting — and left it blank when the pointer moved
   * away mid-load.
   */
  const [previewPainted, setPreviewPainted] = useState(false);
  const watchProgress = useWatchProgress(videoId);
  const resumeFractionRef = useRef<number | null>(null);
  resumeFractionRef.current =
    watchProgress &&
    !watchProgress.completed &&
    watchProgress.fraction > 0.01 &&
    watchProgress.fraction < COMPLETION_RATIO
      ? watchProgress.fraction
      : null;

  // Hydrate the sticky sound preference after mount (previews are
  // client-only, so there is no SSR mismatch to worry about).
  useEffect(() => {
    if (!readPreviewMutedPref()) setPreviewMuted(false);
  }, []);

  useEffect(() => {
    if (!pointerInside) {
      setDwellOk(false);
      return;
    }
    const t = window.setTimeout(() => setDwellOk(true), DWELL_MS);
    return () => window.clearTimeout(t);
  }, [pointerInside]);

  const displayThumbnailUrl = useMemo(
    () =>
      browserImageUrl(preferHighResVideoThumbnailUrl(thumbnailUrl, videoId)),
    [thumbnailUrl, videoId],
  );

  // Hover previews are a pointer/desktop affordance. On touch devices the
  // synthesized mouseenter plus the preview <video> swapping in over the link
  // swallowed taps, so opening a video took several taps. Gate the preview to
  // hover-capable devices; touch taps then navigate straight through.
  const [hoverCapable, setHoverCapable] = useState(false);
  useEffect(() => {
    setHoverCapable(
      typeof window !== "undefined" &&
        window.matchMedia?.("(hover: hover)").matches === true,
    );
  }, []);

  const queryEnabled =
    hoverCapable &&
    !disableHoverPreview &&
    pointerInside &&
    dwellOk &&
    videoId.length >= 11;

  useEffect(() => {
    if (!pointerInside || !dwellOk) return;
    router.prefetch(href.split("?")[0] ?? href);
  }, [pointerInside, dwellOk, router, href]);

  const detailQuery = trpc.video.detail.useQuery(
    { videoId },
    { enabled: queryEnabled, staleTime: 5 * 60_000 },
  );

  // A low-resolution HLS stream of the video (VOD only).
  const playback = useMemo((): { src: string } | null => {
    if (!pointerInside || !detailQuery.data) return null;
    const src = previewStreamFromDetail(detailQuery.data);
    return src ? { src } : null;
  }, [pointerInside, detailQuery.data]);

  useEffect(() => {
    const v = videoRef.current;
    if (!pointerInside || !playback) {
      previewActiveRef.current = false;
      teardownMedia(v, hlsDestroyRef.current);
      hlsDestroyRef.current = null;
      return;
    }

    let cancelled = false;

    hlsDestroyRef.current?.();
    hlsDestroyRef.current = null;

    void (async () => {
      if (!v) return;
      v.playsInline = true;
      v.preload = "metadata";
      v.volume = PREVIEW_VOLUME;

      // Resume where the viewer left off (watch history position).
      const seekToResume = () => {
        const fraction = resumeFractionRef.current;
        if (fraction != null && Number.isFinite(v.duration) && v.duration > 0) {
          v.currentTime = fraction * v.duration;
        }
      };
      if (v.readyState >= HTMLMediaElement.HAVE_METADATA) seekToResume();
      else v.addEventListener("loadedmetadata", seekToResume, { once: true });

      {
        const canNative =
          v.canPlayType("application/vnd.apple.mpegurl") !== "" ||
          v.canPlayType("application/x-mpegURL") !== "";
        if (canNative) {
          v.src = playback.src;
          v.muted = previewMutedRef.current;
          try {
            await v.play();
            if (!cancelled && pointerInsideRef.current) {
              previewActiveRef.current = true;
            }
          } catch {
            if (!v.muted) {
              v.muted = true;
              try {
                await v.play();
                if (!cancelled && pointerInsideRef.current) {
                  previewActiveRef.current = true;
                }
                return;
              } catch {
                // fall through
              }
            }
            previewActiveRef.current = false;
          }
          return;
        }
        try {
          const { default: Hls } = await import("hls.js");
          if (!Hls.isSupported() || cancelled) return;
          const hls = new Hls({
            ...hlsVodConfig(),
            maxBufferLength: 8,
            maxMaxBufferLength: 20,
          });
          hls.loadSource(playback.src);
          hls.attachMedia(v);
          hlsDestroyRef.current = () => {
            hls.destroy();
          };
          v.muted = previewMutedRef.current;
          await new Promise<void>((resolve, reject) => {
            const to = window.setTimeout(() => {
              hls.off(Hls.Events.MANIFEST_PARSED, onParsed);
              hls.off(Hls.Events.ERROR, onErr);
              reject(new Error("hls manifest timeout"));
            }, 12_000);
            const onParsed = () => {
              window.clearTimeout(to);
              hls.off(Hls.Events.ERROR, onErr);
              resolve();
            };
            const onErr = (_: string, data: { fatal?: boolean }) => {
              if (!data.fatal) return;
              window.clearTimeout(to);
              hls.off(Hls.Events.MANIFEST_PARSED, onParsed);
              reject(new Error("hls"));
            };
            hls.on(Hls.Events.MANIFEST_PARSED, onParsed);
            hls.on(Hls.Events.ERROR, onErr);
          });
          if (cancelled) return;
          await v.play();
          if (!cancelled && pointerInsideRef.current) {
            previewActiveRef.current = true;
          }
        } catch {
          previewActiveRef.current = false;
        }
      }
    })();

    return () => {
      cancelled = true;
      teardownMedia(videoRef.current, hlsDestroyRef.current);
      hlsDestroyRef.current = null;
      previewActiveRef.current = false;
    };
  }, [pointerInside, playback]);

  // Flip the crossfade only once the preview video has decodable frames.
  useEffect(() => {
    const v = videoRef.current;
    if (!playback || !v) {
      setPreviewPainted(false);
      return;
    }
    const mark = () => {
      if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        setPreviewPainted(true);
      }
    };
    mark();
    v.addEventListener("loadeddata", mark);
    v.addEventListener("playing", mark);
    return () => {
      v.removeEventListener("loadeddata", mark);
      v.removeEventListener("playing", mark);
      setPreviewPainted(false);
    };
  }, [playback]);

  // Thumbnail scrubber follows the preview while it plays.
  useEffect(() => {
    const v = videoRef.current;
    if (!playback || !v) {
      setPreviewFraction(null);
      return;
    }
    const onTime = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        setPreviewFraction(Math.min(1, v.currentTime / v.duration));
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      setPreviewFraction(null);
    };
  }, [playback]);

  useEffect(() => {
    const v = videoRef.current;
    if (!playback || !v) return;
    v.muted = previewMuted;
    if (!previewMuted) v.volume = PREVIEW_VOLUME;
  }, [previewMuted, playback]);

  const onThumbClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const v = videoRef.current;
      if (!v || !previewActiveRef.current) return;
      const sec = Math.floor(v.currentTime);
      if (sec <= 0) return;
      e.preventDefault();
      // Preserve the href's existing query (notably ?v=<id>) and only set the
      // resume time — splitting on "?" dropped the video id, producing links
      // like /watch?t=8 with no v.
      const url = new URL(href, window.location.origin);
      url.searchParams.set("t", String(sec));
      router.push(`${url.pathname}${url.search}`);
    },
    [href, router],
  );

  const showMute = Boolean(playback);

  return (
    <section
      aria-label="Video thumbnail"
      className={thumbClassName}
      onMouseEnter={() => setPointerInside(true)}
      onMouseLeave={() => setPointerInside(false)}
    >
      <Link
        prefetch={false}
        href={href}
        className="relative block h-full w-full min-h-0"
        onClick={onThumbClick}
      >
        {displayThumbnailUrl ? (
          // biome-ignore lint/performance/noImgElement: third-party instance thumbnails
          <img
            src={displayThumbnailUrl}
            alt=""
            className={cn(
              imgClassName,
              // Swap instantly (transition transform only): a slow opacity
              // fade kept cards blank for ~500ms after the pointer left.
              "transition-transform",
              playback && previewPainted ? "opacity-0" : "opacity-100",
            )}
            loading="lazy"
            onError={(e) => applyVideoThumbnailImgError(e.currentTarget)}
          />
        ) : null}
        {/* biome-ignore lint/a11y/useMediaCaption: silent card preview */}
        <video
          ref={videoRef}
          data-ot-preview={videoId}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
            playback && previewPainted
              ? "opacity-100"
              : "pointer-events-none opacity-0",
          )}
          playsInline
        />
        {!(playback && previewPainted) ? (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            aria-hidden
          >
            <svg
              width="56"
              height="56"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="scale-90 text-white drop-shadow-lg transition duration-300 group-hover:scale-100"
            >
              <title>Play</title>
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          </div>
        ) : null}
      </Link>
      <VideoWatchProgress videoId={videoId} liveFraction={previewFraction} />
      {/* Outside the watch link: the status pills navigate on their own. */}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex items-center justify-end gap-1">
        <VideoStatusPills videoId={videoId} surface={surface} />
        <VideoCardDurationBadge
          durationSeconds={durationSeconds}
          isLive={isLive}
          isUpcoming={isUpcoming}
          positioned={false}
          className="px-2 py-0.5 text-[11px]"
        />
      </div>
      {showMute ? (
        <button
          type="button"
          className="absolute left-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/75 text-white shadow-md backdrop-blur-sm transition hover:bg-black/90"
          aria-pressed={!previewMuted}
          aria-label={previewMuted ? "Unmute preview" : "Mute preview"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPreviewMuted((m) => {
              const next = !m;
              writePreviewMutedPref(next);
              return next;
            });
          }}
        >
          {previewMuted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <title>Muted</title>
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <title>Sound on</title>
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          )}
        </button>
      ) : null}
    </section>
  );
}
