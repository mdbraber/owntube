"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ScrubFramePreview,
  ScrubPreviewConfig,
} from "@/hooks/use-scrub-frame-preview";
import { cn } from "@/lib/utils";
import { applyVideoThumbnailImgError } from "@/lib/video-thumbnail-url";

function ScrubPreviewVisual({
  frame,
  scrubPreview,
  previewRef,
  previewVideoFailed,
  onPreviewVideoError,
  previewSeekKey,
}: {
  frame: ScrubFramePreview | null;
  scrubPreview: ScrubPreviewConfig;
  previewRef: React.RefObject<HTMLVideoElement | null>;
  previewVideoFailed: boolean;
  onPreviewVideoError: () => void;
  previewSeekKey: number | null;
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

  if (frame && !frameFailed) {
    if (frame.backgroundSize) {
      return (
        <div
          className="relative shrink-0 overflow-hidden rounded-md bg-zinc-950 shadow-lg ring-1 ring-white/20"
          style={{
            width: frame.width,
            height: frame.height,
            backgroundImage: `url(${frame.url})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: frame.backgroundSize,
            backgroundPosition: frame.backgroundPosition ?? "0 0",
          }}
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
        width={frame.width}
        height={frame.height}
        className="relative shrink-0 rounded-md bg-zinc-950 object-cover shadow-lg ring-1 ring-white/20"
        onError={() => setFrameFailed(true)}
      />
    );
  }

  return (
    <div className="relative aspect-video w-[7.5rem] shrink-0 overflow-hidden rounded-md bg-zinc-950 shadow-lg ring-1 ring-white/20">
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
          preload="auto"
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

export function ScrubPreviewOverlay({
  hover,
  duration,
  scrubPreview,
}: {
  hover: number;
  duration: number;
  scrubPreview: ScrubPreviewConfig;
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
    />
  );
}
