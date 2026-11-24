"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Seek indicator: "◀◀◀ 10 seconds" on the side the video jumped toward.       */
/* -------------------------------------------------------------------------- */

export type SeekIndicatorState = {
  dir: "back" | "forward";
  seconds: number;
  /** "key": a marker beside the center (desktop); "tap": a ripple filling the side (touch). */
  source: "key" | "tap";
  tick: number;
};

/** How long a run of presses/taps keeps adding up, and the marker stays. */
const SEEK_RUN_MS = 800;

/**
 * Seek feedback that adds up like YouTube's: pressing → three times reads
 * "15 seconds", not three separate "5 seconds". A press the other way
 * starts a new run.
 */
export function useSeekIndicator() {
  const [state, setState] = useState<SeekIndicatorState | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback(
    (dir: "back" | "forward", seconds: number, source: "key" | "tap") => {
      setState((prev) => ({
        dir,
        source,
        seconds:
          prev && prev.dir === dir && prev.source === source
            ? prev.seconds + seconds
            : seconds,
        tick: Date.now(),
      }));
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState(null), SEEK_RUN_MS);
    },
    [],
  );
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  const clear = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setState(null);
  }, []);
  return { seekIndicator: state, showSeek: show, clearSeek: clear };
}

function SeekArrows({
  dir,
  size = "sm",
}: {
  dir: "back" | "forward";
  size?: "sm" | "lg";
}) {
  // Three triangles lighting up one after another in the seek direction.
  const order = dir === "forward" ? [0, 1, 2] : [2, 1, 0];
  return (
    <span className="flex items-center" aria-hidden>
      {order.map((delay, i) => (
        <svg
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed set of three
          key={i}
          viewBox="0 0 12 14"
          className={cn(
            "animate-[ot-seek-arrow_0.75s_linear_infinite] fill-current opacity-30",
            size === "lg" ? "h-5 w-4" : "h-3.5 w-3",
          )}
          style={{ animationDelay: `${delay * 0.25}s` }}
        >
          <title>{dir === "forward" ? "Forward" : "Back"}</title>
          <path d={dir === "forward" ? "M1 1v12l10-6z" : "M11 1v12L1 7z"} />
        </svg>
      ))}
    </span>
  );
}

export function SeekIndicator({ state }: { state: SeekIndicatorState | null }) {
  if (!state) return null;
  const label = `${state.seconds} seconds`;
  const forward = state.dir === "forward";
  if (state.source === "tap") {
    // Touch: a soft ripple filling that side of the video, curved toward the
    // middle, with the arrows and the running total in it.
    return (
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 z-30 flex w-[40%] items-center justify-center bg-white/15 text-white",
          forward
            ? "right-0 rounded-l-[50%/100%]"
            : "left-0 rounded-r-[50%/100%]",
        )}
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-1.5 text-xs font-medium drop-shadow">
          <SeekArrows dir={state.dir} />
          <span>{label}</span>
        </div>
      </div>
    );
  }
  // Keyboard: arrows and the total at the far edge, straight on the video.
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-1/2 z-30 -translate-y-1/2",
        forward ? "right-[5%]" : "left-[5%]",
      )}
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-1.5 text-sm font-medium text-white [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.8))]">
        <SeekArrows dir={state.dir} size="lg" />
        <span>{label}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bezel: the round play/pause icon that pops and fades after a toggle.       */
/* -------------------------------------------------------------------------- */

export function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("fill-current", className)}>
      <title>Play</title>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
    </svg>
  );
}

export function PauseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("fill-current", className)}>
      <title>Pause</title>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function PrevGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("fill-current", className)}>
      <title>Previous</title>
      <rect x="5" y="6" width="2.4" height="12" rx="0.8" />
      <path d="M19 6.9v10.2a.9.9 0 0 1-1.38.76L9.8 12.76a.9.9 0 0 1 0-1.52l7.82-5.1A.9.9 0 0 1 19 6.9z" />
    </svg>
  );
}

function NextGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("fill-current", className)}>
      <title>Next</title>
      <rect x="16.6" y="6" width="2.4" height="12" rx="0.8" />
      <path d="M5 6.9v10.2a.9.9 0 0 0 1.38.76l7.82-5.1a.9.9 0 0 0 0-1.52l-7.82-5.1A.9.9 0 0 0 5 6.9z" />
    </svg>
  );
}

/** Shown after play/pause changes: what just happened, popping and fading. */
export function PlayPauseBezel({
  hint,
}: {
  hint: { kind: "play" | "pause"; tick: number } | null;
}) {
  if (!hint) return null;
  return (
    <div
      key={hint.tick}
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
    >
      <div className="flex h-[52px] w-[52px] animate-[ot-bezel_0.5s_linear_forwards] items-center justify-center rounded-full bg-black/50 text-white">
        {hint.kind === "play" ? (
          <PlayGlyph className="ml-0.5 h-7 w-7" />
        ) : (
          <PauseGlyph className="h-7 w-7" />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Touch transport: previous · play/pause · next, over a dimmed video.        */
/* -------------------------------------------------------------------------- */

export function TouchTransport({
  shown,
  paused,
  onTogglePaused,
  onPrev,
  onNext,
}: {
  shown: boolean;
  paused: boolean;
  onTogglePaused: () => void;
  /** Null when there is no previous/next video: the button is dimmed. */
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}) {
  const side =
    "flex h-[clamp(2.5rem,11cqmin,4rem)] w-[clamp(2.5rem,11cqmin,4rem)] items-center justify-center rounded-full bg-black/40 text-white transition active:scale-90 disabled:opacity-40";
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-30 flex items-center justify-center gap-[clamp(2rem,12cqmin,6rem)] bg-black/35 transition-opacity duration-200 [container-type:size]",
        shown ? "opacity-100" : "opacity-0",
      )}
      data-controls
    >
      <button
        type="button"
        aria-label="Previous video"
        disabled={!onPrev}
        onClick={(e) => {
          e.stopPropagation();
          onPrev?.();
        }}
        className={cn(side, shown && "pointer-events-auto")}
      >
        <PrevGlyph className="h-1/2 w-1/2" />
      </button>
      <button
        type="button"
        aria-label={paused ? "Play" : "Pause"}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePaused();
        }}
        className={cn(
          "flex h-[clamp(3.5rem,16cqmin,6rem)] w-[clamp(3.5rem,16cqmin,6rem)] items-center justify-center rounded-full bg-black/40 text-white transition active:scale-95",
          shown && "pointer-events-auto",
        )}
      >
        {paused ? (
          <PlayGlyph className="ml-[6%] h-[55%] w-[55%]" />
        ) : (
          <PauseGlyph className="h-1/2 w-1/2" />
        )}
      </button>
      <button
        type="button"
        aria-label="Next video"
        disabled={!onNext}
        onClick={(e) => {
          e.stopPropagation();
          onNext?.();
        }}
        className={cn(side, shown && "pointer-events-auto")}
      >
        <NextGlyph className="h-1/2 w-1/2" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Watch trail: the videos played in this tab, for "Previous video".          */
/* -------------------------------------------------------------------------- */

const TRAIL_KEY = "ot-watch-trail";

function readTrail(): string[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Records the videos watched in this tab and returns the one before the
 * current one (null if none). Going back to it pops the current one off, so
 * "previous" keeps walking back like YouTube's.
 */
export function usePreviousVideo(
  videoId: string,
  enabled: boolean,
): string | null {
  const [prev, setPrev] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !videoId) return;
    const trail = readTrail();
    if (trail[trail.length - 1] !== videoId) {
      if (trail[trail.length - 2] === videoId) trail.pop();
      else trail.push(videoId);
    }
    const kept = trail.slice(-50);
    try {
      sessionStorage.setItem(TRAIL_KEY, JSON.stringify(kept));
    } catch {
      /* storage full or blocked: previous just stays unavailable */
    }
    setPrev(kept.length > 1 ? (kept[kept.length - 2] ?? null) : null);
  }, [videoId, enabled]);
  return prev;
}

/* -------------------------------------------------------------------------- */
/* Pointer kind                                                               */
/* -------------------------------------------------------------------------- */

/** True on touch-first devices (no hover, coarse pointer). */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
}
