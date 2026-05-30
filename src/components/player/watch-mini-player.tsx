"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { VideoPlayer } from "@/components/player/video-player";
import { Button } from "@/components/ui/button";
import {
  readWatchMiniEnabled,
  readWatchMiniState,
  type WatchMiniState,
  writeWatchMiniState,
} from "@/lib/watch-mini-player-state";

type WatchMiniPlayerProps = {
  isLoggedIn: boolean;
};

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

  useEffect(() => {
    if (!activeVideoId || hidden) return;
    const v = wrapRef.current?.querySelector(
      "video",
    ) as HTMLVideoElement | null;
    if (!v) return;
    const videoId = activeVideoId;
    const sync = () => {
      persistMiniPlayback(videoId, v, () => stateRef.current);
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
    if (!state) return;
    const href = `/watch/${encodeURIComponent(state.videoId)}?t=${Math.floor(state.currentTime || 0)}`;
    writeWatchMiniState(null);
    router.push(href);
  }, [router, state]);

  if (!state || hidden) return null;

  return (
    <aside
      className="fixed z-50 w-[min(420px,94vw)] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-black shadow-2xl"
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
      </div>
      <div className="flex items-center justify-between gap-2 bg-[hsl(var(--card))] px-2.5 py-2">
        <p className="line-clamp-1 text-xs text-[hsl(var(--foreground))]">
          {state.title}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleReopen}
          >
            Reopen
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => writeWatchMiniState(null)}
          >
            Close
          </Button>
        </div>
      </div>
    </aside>
  );
}
