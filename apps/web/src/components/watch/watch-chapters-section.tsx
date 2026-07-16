"use client";

import Link from "next/link";
import { watchHref } from "@/lib/yt-routes";
import { useEffect } from "react";
import {
  type ScrubFramePreview,
  useScrubFramePreview,
} from "@/hooks/use-scrub-frame-preview";
import type { VideoChapter } from "@/lib/video-chapters";
import { scrubFrameStyleAt } from "@/lib/video-scrub-frames";
import type { VideoStoryboard } from "@/server/services/proxy.types";

type WatchChaptersSectionProps = {
  videoId: string;
  chapters: VideoChapter[];
  durationSeconds?: number;
  storyboard?: VideoStoryboard;
  scrubPreviewStreamSrc?: string;
};

function formatChapterClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function ChapterThumbnail({
  frame,
  fallback,
}: {
  frame: ScrubFramePreview | null;
  fallback: ScrubFramePreview;
}) {
  const active = frame ?? fallback;

  if (active.backgroundSize) {
    return (
      <div
        className="h-full w-full bg-zinc-950"
        style={{
          backgroundImage: `url(${active.url})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: active.backgroundSize,
          backgroundPosition: active.backgroundPosition ?? "0 0",
        }}
        aria-hidden
      />
    );
  }

  return (
    // biome-ignore lint/performance/noImgElement: chapter preview from scrub frames
    <img
      src={active.url}
      alt=""
      className="h-full w-full object-cover"
      loading="lazy"
    />
  );
}

export function WatchChaptersSection({
  videoId,
  chapters,
  durationSeconds,
  storyboard,
  scrubPreviewStreamSrc,
}: WatchChaptersSectionProps) {
  const { frameAt, primeFrames, frameTick } = useScrubFramePreview({
    videoId,
    durationSeconds,
    storyboard,
    scrubPreviewStreamSrc,
  });

  useEffect(() => {
    primeFrames();
  }, [primeFrames]);

  if (chapters.length <= 1) return null;

  const duration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? Math.max(1, durationSeconds)
      : 1;

  void frameTick;

  return (
    <details
      open
      className="group rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Chapters ({chapters.length})
        </span>
        <span className="text-xs text-[hsl(var(--muted-foreground))] transition group-open:rotate-180">
          ▼
        </span>
      </summary>
      <ul className="max-h-80 space-y-1 overflow-y-auto border-t border-[hsl(var(--border))] p-2">
        {chapters.map((chapter) => {
          const fallback = scrubFrameStyleAt(
            videoId,
            chapter.startSeconds,
            duration,
            storyboard,
          );
          const frame = frameAt(chapter.startSeconds);

          return (
            <li key={`${chapter.startSeconds}-${chapter.title}`}>
              <Link
                href={watchHref(videoId, { t: chapter.startSeconds })}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-[hsl(var(--muted)_/_0.4)]"
              >
                <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-[hsl(var(--muted))]">
                  <ChapterThumbnail frame={frame} fallback={fallback} />
                  <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-white">
                    {formatChapterClock(chapter.startSeconds)}
                  </span>
                </div>
                <span className="line-clamp-2 text-sm text-[hsl(var(--foreground))]">
                  {chapter.title}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
