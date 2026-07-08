"use client";

import { useEffect, useId, useRef, useState } from "react";
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

  // Snapshot the playback position when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSeconds(readPlayerSeconds());
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
    : `${window.location.origin}/watch/${encodeURIComponent(videoId)}${
        startAt && seconds > 0 ? `?t=${seconds}` : ""
      }`;

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
          <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={startAt}
              onChange={(e) => setStartAt(e.currentTarget.checked)}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            Start at{" "}
            <span className="tabular-nums text-[hsl(var(--muted-foreground))]">
              {formatDuration(seconds) ?? "0:00"}
            </span>
          </label>
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
