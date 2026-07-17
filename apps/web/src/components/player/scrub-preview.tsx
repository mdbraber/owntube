"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ScrubFramePreview,
  ScrubPreviewConfig,
} from "@/hooks/use-scrub-frame-preview";
import { cn } from "@/lib/utils";
import { applyVideoThumbnailImgError } from "@/lib/video-thumbnail-url";

/** Convert a storyboard frame's pixel sprite crop to a percentage background so
 *  the selected cell fills whatever size box we render it in. */
function spritePercentBackground(frame: ScrubFramePreview) {
  const [sheetW, sheetH] = (frame.backgroundSize ?? "")
    .split(" ")
    .map((v) => Number.parseFloat(v));
  const [posX, posY] = (frame.backgroundPosition ?? "0px 0px")
    .split(" ")
    .map((v) => Number.parseFloat(v));
  const cols = Math.max(1, Math.round(sheetW / frame.width));
  const rows = Math.max(1, Math.round(sheetH / frame.height));
  const col = Math.max(0, Math.round(-posX / frame.width));
  const row = Math.max(0, Math.round(-posY / frame.height));
  return {
    backgroundImage: `url(${frame.url})`,
    backgroundRepeat: "no-repeat" as const,
    backgroundSize: `${cols * 100}% ${rows * 100}%`,
    backgroundPosition: `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${
      rows > 1 ? (row / (rows - 1)) * 100 : 0
    }%`,
  };
}

function ScrubPreviewVisual({
  frame,
  scrubPreview,
  previewRef,
  previewVideoFailed,
  onPreviewVideoError,
  previewSeekKey,
  width,
}: {
  frame: ScrubFramePreview | null;
  scrubPreview: ScrubPreviewConfig;
  previewRef: React.RefObject<HTMLVideoElement | null>;
  previewVideoFailed: boolean;
  onPreviewVideoError: () => void;
  previewSeekKey: number | null;
  /** Rendered width in px — sized relative to the player by the caller. */
  width: number;
}) {
  const [frameFailed, setFrameFailed] = useState(false);
  const [videoSeekReady, setVideoSeekReady] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: frame URL changes reset the probe state for the current storyboard frame.
  useEffect(() => {
    setFrameFailed(false);
  }, [frame?.url]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: preview source/seek key changes reset readiness before the next preview seek.
  useEffect(() => {
    setVideoSeekReady(false);
  }, [previewSeekKey, scrubPreview.streamSrc]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: previewRef.current is sampled after render; ref mutations do not drive renders.
  useEffect(() => {
    if (frame || !scrubPreview.streamSrc || previewVideoFailed) return;
    const v = previewRef.current;
    if (!v) return;
    const onSeeked = () => setVideoSeekReady(true);
    const onLoaded = () => {
      if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        setVideoSeekReady(true);
      }
    };
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("loadeddata", onLoaded);
    return () => {
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("loadeddata", onLoaded);
    };
  }, [frame, scrubPreview.streamSrc, previewVideoFailed]);

  const aspect = `${frame?.width ?? 16} / ${frame?.height ?? 9}`;

  if (frame && !frameFailed) {
    if (frame.backgroundSize) {
      return (
        <div
          className="relative shrink-0 overflow-hidden rounded-md bg-zinc-950 shadow-lg ring-1 ring-white/20"
          style={{ width, aspectRatio: aspect, ...spritePercentBackground(frame) }}
          aria-hidden
        >
          {/* biome-ignore lint/performance/noImgElement: probe storyboard sheet load */}
          <img
            src={frame.url}
            alt=""
            className="absolute h-0 w-0 opacity-0"
            onError={() => setFrameFailed(true)}
          />
        </div>
      );
    }
    return (
      // biome-ignore lint/performance/noImgElement: timeline scrub thumbnail
      <img
        src={frame.url}
        alt=""
        style={{ width, aspectRatio: aspect }}
        className="relative shrink-0 rounded-md bg-zinc-950 object-cover shadow-lg ring-1 ring-white/20"
        onError={() => setFrameFailed(true)}
      />
    );
  }

  return (
    <div
      className="relative aspect-video shrink-0 overflow-hidden rounded-md bg-zinc-950 shadow-lg ring-1 ring-white/20"
      style={{ width }}
    >
      {scrubPreview.poster ? (
        // biome-ignore lint/performance/noImgElement: scrub preview still
        <img
          src={scrubPreview.poster}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => applyVideoThumbnailImgError(e.currentTarget)}
        />
      ) : null}
      {scrubPreview.streamSrc && !previewVideoFailed ? (
        <video
          key={scrubPreview.streamSrc}
          ref={previewRef}
          src={scrubPreview.streamSrc}
          muted
          playsInline
          // "metadata", not "auto": hover-seeks fetch what they need; "auto"
          // streams the whole file and blocks player seeks on the connection.
          preload="metadata"
          className={cn(
            "relative z-[1] h-full w-full object-cover transition-opacity",
            videoSeekReady ? "opacity-100" : "opacity-0",
          )}
          aria-hidden
          onError={onPreviewVideoError}
        />
      ) : null}
    </div>
  );
}

/**
 * Scrub frame shown ON the video while the viewer is actively dragging the
 * scrubber (YouTube-style, especially on touch). Fills the whole video frame:
 * the storyboard cell is converted from its pixel crop to a percentage-based
 * background so it scales to cover any player size. Falls back to a canvas
 * frame (cover), then the poster still, then nothing.
 */
export function ScrubPreviewStage({
  time,
  scrubPreview,
}: {
  time: number;
  scrubPreview: ScrubPreviewConfig;
}) {
  const [failed, setFailed] = useState(false);
  const frame = scrubPreview.frameAt?.(time) ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the load probe when the frame image changes.
  useEffect(() => setFailed(false), [frame?.url]);

  const fill = "absolute inset-0 h-full w-full";

  if (frame && !failed) {
    if (frame.backgroundSize) {
      // Pixel sprite crop → percentage background so the selected cell scales to
      // fill the frame regardless of player size. Grid geometry is recovered
      // from the sheet size (cols×rows) and the cell offset.
      const [sheetW, sheetH] = frame.backgroundSize
        .split(" ")
        .map((v) => Number.parseFloat(v));
      const [posX, posY] = (frame.backgroundPosition ?? "0px 0px")
        .split(" ")
        .map((v) => Number.parseFloat(v));
      const cols = Math.max(1, Math.round(sheetW / frame.width));
      const rows = Math.max(1, Math.round(sheetH / frame.height));
      const col = Math.max(0, Math.round(-posX / frame.width));
      const row = Math.max(0, Math.round(-posY / frame.height));
      const bgSize = `${cols * 100}% ${rows * 100}%`;
      const bgPos = `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${
        rows > 1 ? (row / (rows - 1)) * 100 : 0
      }%`;
      return (
        <div
          className={cn(fill, "bg-black")}
          aria-hidden
          style={{
            backgroundImage: `url(${frame.url})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: bgSize,
            backgroundPosition: bgPos,
          }}
        >
          {/* biome-ignore lint/performance/noImgElement: probe storyboard sheet load */}
          <img
            src={frame.url}
            alt=""
            className="h-0 w-0 opacity-0"
            onError={() => setFailed(true)}
          />
        </div>
      );
    }
    return (
      // biome-ignore lint/performance/noImgElement: full-frame scrub thumbnail
      <img
        src={frame.url}
        alt=""
        className={cn(fill, "bg-black object-contain")}
        onError={() => setFailed(true)}
        aria-hidden
      />
    );
  }

  if (scrubPreview.poster) {
    return (
      // biome-ignore lint/performance/noImgElement: scrub preview still fallback
      <img
        src={scrubPreview.poster}
        alt=""
        className={cn(fill, "bg-black object-contain")}
        onError={(e) => applyVideoThumbnailImgError(e.currentTarget)}
        aria-hidden
      />
    );
  }
  return null;
}

export function ScrubPreviewOverlay({
  hover,
  duration,
  scrubPreview,
  width = 120,
}: {
  hover: number;
  duration: number;
  scrubPreview: ScrubPreviewConfig;
  /** Preview width in px, sized relative to the player by the caller. */
  width?: number;
}) {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [previewVideoFailed, setPreviewVideoFailed] = useState(false);
  const previewFailedRef = useRef(false);
  const seekTimerRef = useRef<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: preview source changes reset the stream-preview failure latch.
  useEffect(() => {
    previewFailedRef.current = false;
    setPreviewVideoFailed(false);
  }, [scrubPreview.streamSrc]);

  useEffect(() => {
    if (seekTimerRef.current != null) {
      window.clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }
    if (!scrubPreview.streamSrc || duration <= 0) return;
    seekTimerRef.current = window.setTimeout(() => {
      seekTimerRef.current = null;
      if (previewFailedRef.current) return;
      const v = previewRef.current;
      if (!v) return;
      const t = Math.max(0, Math.min(hover, duration - 0.05));
      try {
        if (Math.abs(v.currentTime - t) > 0.15) {
          v.currentTime = t;
        } else {
          v.dispatchEvent(new Event("seeked"));
        }
      } catch {
        /* ignore */
      }
    }, 50);
    return () => {
      if (seekTimerRef.current != null) {
        window.clearTimeout(seekTimerRef.current);
        seekTimerRef.current = null;
      }
    };
  }, [hover, duration, scrubPreview.streamSrc]);

  const onPreviewVideoError = useCallback(() => {
    previewFailedRef.current = true;
    setPreviewVideoFailed(true);
  }, []);

  return (
    <ScrubPreviewVisual
      frame={scrubPreview.frameAt?.(hover) ?? null}
      scrubPreview={scrubPreview}
      previewRef={previewRef}
      previewVideoFailed={previewVideoFailed}
      onPreviewVideoError={onPreviewVideoError}
      previewSeekKey={hover}
      width={width}
    />
  );
}
