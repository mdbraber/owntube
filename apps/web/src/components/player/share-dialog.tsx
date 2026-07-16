"use client";

import { useEffect, useId, useRef, useState } from "react";
import { watchHref } from "@/lib/yt-routes";
import { createPortal } from "react-dom";
import { useActionToast } from "@/components/videos/action-toast";
import { formatDuration } from "@/lib/video-display";

type ShareDialogProps = {
  videoId: string;
  open: boolean;
  onClose: () => void;
};

/** Playback position of the single persistent player, at dialog-open time. */
function readPlayerSeconds(): number {
  const video = document.querySelector<HTMLVideoElement>(
    "[data-ot-player-root] video",
  );
  const t = video?.currentTime ?? 0;
  return Number.isFinite(t) ? Math.floor(t) : 0;
}

/** Video length, for clamping an edited start time. 0 when unknown. */
function readPlayerDuration(): number {
  const video = document.querySelector<HTMLVideoElement>(
    "[data-ot-player-root] video",
  );
  const d = video?.duration ?? 0;
  return Number.isFinite(d) && d > 0 ? Math.floor(d) : 0;
}

/** Parse "H:MM:SS", "M:SS", or bare seconds into seconds; null when invalid. */
function parseTimeToSeconds(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.some((p) => !/^\d+$/.test(p.trim()))) return null;
  let secs = 0;
  for (const p of parts) secs = secs * 60 + Number(p);
  return Number.isFinite(secs) ? secs : null;
}

/**
 * Share modal for the watch page: the link to copy, a "Start at" toggle that
 * appends the current playback position, and a "Share as YouTube link"
 * toggle (default on) that switches between youtube.com and this instance.
 */
export function ShareDialog({ videoId, open, onClose }: ShareDialogProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useActionToast();

  const [startAt, setStartAt] = useState(false);
  const [asYouTube, setAsYouTube] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [timeText, setTimeText] = useState("0:00");
  const [duration, setDuration] = useState(0);

  // Snapshot the playback position when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const pos = readPlayerSeconds();
    setSeconds(pos);
    setTimeText(formatDuration(pos) ?? "0:00");
    setDuration(readPlayerDuration());
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const link = asYouTube
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${
        startAt && seconds > 0 ? `&t=${seconds}s` : ""
      }`
    : `${window.location.origin}${watchHref(
        videoId,
        startAt && seconds > 0 ? { t: seconds } : undefined,
      )}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      showToast("Link copied");
      onClose();
    } catch {
      // Clipboard API unavailable (http, permissions) — select for manual copy.
      inputRef.current?.select();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/45 animate-[ot-fade-in_180ms_ease-out] motion-reduce:animate-none"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full rounded-t-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-xl animate-[ot-sheet-in_220ms_cubic-bezier(0.32,0.72,0.22,1)] motion-reduce:animate-none sm:max-w-md sm:rounded-2xl sm:pb-4 sm:animate-[ot-fade-in_180ms_ease-out]"
      >
        <h2 id={titleId} className="m-0 text-base font-semibold">
          Share
        </h2>

        <div className="mt-3 flex gap-2">
          <input
            ref={inputRef}
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.5)] px-3 py-2 text-sm text-[hsl(var(--foreground))]"
            aria-label="Share link"
          />
          <button
            type="button"
            className="shrink-0 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.97]"
            onClick={() => void copy()}
          >
            Copy
          </button>
        </div>

        <div className="mt-4 space-y-2.5">
          <div className="flex select-none items-center gap-2.5 text-sm">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={startAt}
                onChange={(e) => setStartAt(e.currentTarget.checked)}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
              Start at
            </label>
            {/* Editable start time (H:MM:SS / M:SS / seconds); clamped to length. */}
            <input
              type="text"
              inputMode="numeric"
              value={timeText}
              disabled={!startAt}
              onFocus={(e) => {
                if (!startAt) setStartAt(true);
                e.currentTarget.select();
              }}
              onChange={(e) => {
                const raw = e.currentTarget.value;
                setTimeText(raw);
                const parsed = parseTimeToSeconds(raw);
                if (parsed !== null) {
                  setSeconds(
                    duration > 0 ? Math.min(parsed, duration) : parsed,
                  );
                }
              }}
              onBlur={() => {
                const parsed = parseTimeToSeconds(timeText);
                const clamped =
                  parsed === null
                    ? seconds
                    : duration > 0
                      ? Math.min(parsed, duration)
                      : parsed;
                setSeconds(clamped);
                setTimeText(formatDuration(clamped) ?? "0:00");
              }}
              aria-label="Start time"
              className="w-20 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.5)] px-2 py-1 text-center text-sm tabular-nums text-[hsl(var(--foreground))] disabled:opacity-50"
            />
          </div>
          <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={asYouTube}
              onChange={(e) => setAsYouTube(e.currentTarget.checked)}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            Share as YouTube link
          </label>
        </div>
      </div>
    </div>,
    document.body,
  );
}
