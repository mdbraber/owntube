"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { VideoPlayer } from "@/components/player/video-player";
import { cn } from "@/lib/utils";
import {
  readWatchMiniEnabled,
  readWatchMiniState,
  type WatchMiniState,
  writeWatchMiniState,
} from "@/lib/watch-mini-player-state";

type WatchMiniPlayerProps = {
  isLoggedIn: boolean;
};

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function persistMiniPlayback(
  videoId: string,
  video: HTMLVideoElement,
  getBase: () => WatchMiniState | null,
) {
  const base = getBase();
  if (!base || base.videoId !== videoId) return;
  writeWatchMiniState(
    {
      ...base,
      currentTime: video.currentTime,
      paused: video.paused,
    },
    false,
  );
}

export function WatchMiniPlayer({ isLoggedIn }: WatchMiniPlayerProps) {
  const pathname = usePathname();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<WatchMiniState | null>(null);
  const [state, setState] = useState(() => readWatchMiniState());
  const [enabled, setEnabled] = useState(() => readWatchMiniEnabled(true));
  const [progress, setProgress] = useState(0);
  const [entered, setEntered] = useState(false);
  const hidden =
    !isLoggedIn ||
    !enabled ||
    pathname.startsWith("/watch/") ||
    pathname === "/shorts" ||
    pathname.startsWith("/shorts?");

  stateRef.current = state;

  useEffect(() => {
    const load = () => {
      setState(readWatchMiniState());
      setEnabled(readWatchMiniEnabled(true));
    };
    load();
    window.addEventListener("storage", load);
    window.addEventListener("ot:watch-mini-updated", load as EventListener);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener(
        "ot:watch-mini-updated",
        load as EventListener,
      );
    };
  }, []);

  const activeVideoId = state?.videoId;
  const miniStartPaused = state?.paused ?? false;
  const visible = !!state && !hidden;

  // Trigger the slide-in transition once the player is mounted and visible.
  useEffect(() => {
    if (!visible) {
      setEntered(false);
      return;
    }
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, [visible]);

  useEffect(() => {
    if (!activeVideoId || hidden) return;
    const v = wrapRef.current?.querySelector(
      "video",
    ) as HTMLVideoElement | null;
    if (!v) return;
    const videoId = activeVideoId;
    const sync = () => {
      persistMiniPlayback(videoId, v, () => stateRef.current);
      setProgress(v.duration > 0 ? Math.min(1, v.currentTime / v.duration) : 0);
    };
    const onEnded = () => writeWatchMiniState(null);
    v.addEventListener("timeupdate", sync);
    v.addEventListener("pause", sync);
    v.addEventListener("play", sync);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("timeupdate", sync);
      v.removeEventListener("pause", sync);
      v.removeEventListener("play", sync);
      v.removeEventListener("ended", onEnded);
    };
  }, [activeVideoId, hidden]);

  const handleReopen = useCallback(() => {
    const current = stateRef.current ?? readWatchMiniState();
    if (!current) return;
    // Use the live position, not the React snapshot: timeupdate persists to
    // storage silently (notify=false), so `state.currentTime` is stale and would
    // reopen the full player at the wrong spot.
    const v = wrapRef.current?.querySelector<HTMLVideoElement>("video");
    const liveTime =
      v && Number.isFinite(v.currentTime) ? v.currentTime : current.currentTime;
    const href = `/watch/${encodeURIComponent(current.videoId)}?t=${Math.round(liveTime || 0)}`;
    writeWatchMiniState(null);
    router.push(href);
  }, [router]);

  if (!state || hidden) return null;

  return (
    <aside
      className={cn(
        "group fixed z-50 w-[min(420px,94vw)] overflow-hidden rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl ring-1 ring-black/5 transition-all duration-300 ease-out",
        entered ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      )}
      style={{
        bottom: "max(0.75rem, env(safe-area-inset-bottom))",
        right: "max(0.75rem, env(safe-area-inset-right))",
      }}
    >
      <div ref={wrapRef} className="relative aspect-video w-full bg-black">
        <VideoPlayer
          key={`${state.videoId}:${miniStartPaused ? "p" : "r"}`}
          videoId={state.videoId}
          payload={state.payload}
          title={state.title}
          poster={state.poster}
          startAtSeconds={Math.floor(state.currentTime || 0)}
          initialQualityIndex={state.qualityIndex}
          restoredVolume={state.volume}
          restoredMuted={state.muted}
          miniStartPaused={miniStartPaused}
          miniMode
        />

        {/* Hover-reveal controls. Container ignores pointer events so the
            player's own controls stay reachable; only the buttons capture. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-end gap-1.5 bg-gradient-to-b from-black/55 to-transparent p-2 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button
            type="button"
            onClick={handleReopen}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label="Expand to full player"
            title="Expand"
          >
            <ExpandIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => writeWatchMiniState(null)}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label="Close mini player"
            title="Close"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Playback progress along the bottom edge of the video. */}
        <div className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-white/15">
          <div
            className="h-full bg-[hsl(var(--primary))] transition-[width] duration-300 ease-linear"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>
    </aside>
  );
}
