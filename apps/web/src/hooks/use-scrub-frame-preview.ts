"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  type ScrubFrameStyle,
  scrubFrameMarkers,
  scrubFrameStyleAt,
} from "@/lib/video-scrub-frames";
import type { VideoStoryboard } from "@/server/services/proxy.types";

export type ScrubFramePreview = ScrubFrameStyle;

export type ScrubPreviewConfig = {
  streamSrc: string;
  poster?: string;
  primeFrames?: () => void;
  frameAt?: (timeSeconds: number) => ScrubFramePreview | null;
};

function useScrubStoryboardFrameAt(
  videoId: string,
  durationSeconds: number | undefined,
  storyboard: VideoStoryboard | undefined,
) {
  useEffect(() => {
    if (!storyboard || !durationSeconds || durationSeconds <= 0) return;
    for (const t of scrubFrameMarkers(durationSeconds)) {
      const style = scrubFrameStyleAt(videoId, t, durationSeconds, storyboard);
      const img = new Image();
      img.src = style.url;
    }
  }, [videoId, durationSeconds, storyboard]);

  return useCallback(
    (timeSeconds: number): ScrubFramePreview | null => {
      if (!storyboard || !durationSeconds || durationSeconds <= 0) return null;
      return scrubFrameStyleAt(
        videoId,
        timeSeconds,
        durationSeconds,
        storyboard,
      );
    },
    [videoId, durationSeconds, storyboard],
  );
}

type GeneratedFrameCache = {
  frames: Map<number, string>;
  frameSize: { width: number; height: number };
  running: boolean;
};

const generatedFrameCaches = new Map<string, GeneratedFrameCache>();
const generatedFrameTickListeners = new Set<() => void>();
let generatedFrameTick = 0;

function subscribeGeneratedFrameTick(onStoreChange: () => void) {
  generatedFrameTickListeners.add(onStoreChange);
  return () => {
    generatedFrameTickListeners.delete(onStoreChange);
  };
}

function getGeneratedFrameTickSnapshot() {
  return generatedFrameTick;
}

function bumpGeneratedFrameTick() {
  generatedFrameTick += 1;
  for (const listener of generatedFrameTickListeners) {
    listener();
  }
}

function generatedFrameCacheKey(
  streamSrc: string,
  durationSeconds: number,
): string {
  return `${streamSrc}\0${durationSeconds}`;
}

function getGeneratedFrameCache(
  streamSrc: string,
  durationSeconds: number,
): GeneratedFrameCache {
  const key = generatedFrameCacheKey(streamSrc, durationSeconds);
  let cache = generatedFrameCaches.get(key);
  if (!cache) {
    cache = {
      frames: new Map(),
      frameSize: { width: 160, height: 90 },
      running: false,
    };
    generatedFrameCaches.set(key, cache);
  }
  return cache;
}

function useGeneratedScrubFrameAt(
  streamSrc: string | undefined,
  durationSeconds: number | undefined,
) {
  const frameTick = useSyncExternalStore(
    subscribeGeneratedFrameTick,
    getGeneratedFrameTickSnapshot,
    getGeneratedFrameTickSnapshot,
  );

  const capture = useCallback(async () => {
    if (!streamSrc || !durationSeconds || durationSeconds <= 0) return;
    const cache = getGeneratedFrameCache(streamSrc, durationSeconds);
    if (cache.running) return;
    cache.running = true;
    const video = document.createElement("video");
    video.src = streamSrc;
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      cache.running = false;
      return;
    }

    const waitLoaded = new Promise<void>((resolve, reject) => {
      const onOk = () => resolve();
      const onErr = () => reject(new Error("scrub frame stream load failed"));
      video.addEventListener("loadedmetadata", onOk, { once: true });
      video.addEventListener("error", onErr, { once: true });
    });

    try {
      await waitLoaded;
      const vw = Math.max(1, Math.floor(video.videoWidth || 160));
      const vh = Math.max(1, Math.floor(video.videoHeight || 90));
      const targetWidth = 160;
      const targetHeight = Math.max(1, Math.round((targetWidth * vh) / vw));
      cache.frameSize = { width: targetWidth, height: targetHeight };
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const markers = scrubFrameMarkers(durationSeconds, 5);
      for (const marker of markers) {
        const seekTo = Math.max(0, Math.min(marker, durationSeconds - 0.05));
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          video.addEventListener("seeked", done, { once: true });
          try {
            video.currentTime = seekTo;
          } catch {
            resolve();
          }
        });
        try {
          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          const data = canvas.toDataURL("image/jpeg", 0.62);
          cache.frames.set(marker, data);
          bumpGeneratedFrameTick();
        } catch {
          // ignore single-frame failures
        }
      }
    } catch {
      // ignore preview frame generation failures
    } finally {
      cache.running = false;
    }
  }, [streamSrc, durationSeconds]);

  const frameAt = useCallback(
    (timeSeconds: number): ScrubFramePreview | null => {
      void frameTick;
      if (!streamSrc || !durationSeconds || durationSeconds <= 0) return null;
      const cache = getGeneratedFrameCache(streamSrc, durationSeconds);
      const bucket = Math.max(0, Math.floor(timeSeconds / 5) * 5);
      const direct = cache.frames.get(bucket);
      if (direct) {
        return {
          url: direct,
          width: cache.frameSize.width,
          height: cache.frameSize.height,
        };
      }
      return null;
    },
    [streamSrc, durationSeconds, frameTick],
  );

  return { frameAt, primeFrames: capture, frameTick };
}

export function useScrubFramePreview({
  videoId,
  durationSeconds,
  storyboard,
  scrubPreviewStreamSrc,
}: {
  videoId: string;
  durationSeconds?: number;
  storyboard?: VideoStoryboard;
  scrubPreviewStreamSrc?: string;
}) {
  const storyboardFrameAt = useScrubStoryboardFrameAt(
    videoId,
    durationSeconds,
    storyboard,
  );
  const generated = useGeneratedScrubFrameAt(
    scrubPreviewStreamSrc,
    durationSeconds,
  );

  const frameAt = useCallback(
    (timeSeconds: number): ScrubFramePreview | null => {
      if (storyboard) {
        return generated.frameAt(timeSeconds) ?? storyboardFrameAt(timeSeconds);
      }
      return generated.frameAt(timeSeconds);
    },
    [storyboard, generated.frameAt, storyboardFrameAt],
  );

  return {
    frameAt,
    primeFrames: generated.primeFrames,
    frameTick: generated.frameTick,
  };
}

export function mergeScrubPreview(
  streamSrc: string,
  poster: string | undefined,
  primeFrames: (() => void) | undefined,
  frameAt: ((timeSeconds: number) => ScrubFramePreview | null) | undefined,
): ScrubPreviewConfig {
  return {
    streamSrc,
    ...(poster ? { poster } : {}),
    ...(primeFrames ? { primeFrames } : {}),
    ...(frameAt ? { frameAt } : {}),
  };
}
