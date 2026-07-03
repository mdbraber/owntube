"use client";

import Link from "next/link";
import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  formatClock,
  LIVE_EDGE_SECONDS,
} from "@/components/player/player-constants";
import {
  ProgressBar,
  SettingsMenu,
  ShortsProgressBar,
  ShortsQualityPicker,
  ShortsTopControls,
  VolumeSlider,
} from "@/components/player/player-controls";
import {
  useFullscreenShell,
  useIdleVisible,
} from "@/components/player/player-fullscreen";
import {
  BigPlayOverlayIcon,
  CinemaIcon,
  FsEnterIcon,
  FsExitIcon,
  GearIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  VolHighIcon,
  VolLowIcon,
} from "@/components/player/player-icons";
import { usePlayerKeyboardShortcuts } from "@/components/player/player-keyboard";
import type { ChromeProps } from "@/components/player/player-types";
import { useSponsorBlockAutoSkip } from "@/hooks/use-sponsorblock-auto-skip";
import { cn } from "@/lib/utils";
import { chapterIndexAt } from "@/lib/video-chapters";

export function PlayerChrome({
  adapter,
  shellRef,
  title,
  chapters,
  videoId,
  sponsorSegments,
  sponsorBlockPrefs,
  quality,
  audio,
  settingsOpen,
  onSettingsOpenChange,
  cinemaMode,
  onExitCinema,
  onToggleCinema,
  scrubPreview,
  centerHint,
  nextUp,
  queue = [],
  autoplayNext,
  onToggleAutoplayNext,
  onPlayNext,
  miniMode = false,
  shortsMode = false,
  miniStartPaused = false,
  isLive = false,
}: ChromeProps) {
  const [hydrated, setHydrated] = useState(false);
  const { active: fsActive, toggle: toggleFs } = useFullscreenShell(shellRef);
  const { visible, ping, hide } = useIdleVisible(adapter.paused, settingsOpen);
  const [scrub, setScrub] = useState<number | null>(null);
  const [showVolPanel, setShowVolPanel] = useState(false);
  const [shortsQualityOpen, setShortsQualityOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [autoCenterHint, setAutoCenterHint] = useState<{
    kind: "play" | "pause";
    tick: number;
  } | null>(null);
  const prevPausedRef = useRef<boolean | null>(null);
  const miniAutoplayTriedRef = useRef(false);
  const miniShouldAutoplay = miniMode && !miniStartPaused;

  useSponsorBlockAutoSkip({
    adapter,
    segments: sponsorSegments,
    prefs: sponsorBlockPrefs,
    isScrubbing: scrub !== null,
    videoId,
  });

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!miniShouldAutoplay || shortsMode) return;
    if (miniAutoplayTriedRef.current) return;
    if (!adapter.canPlay || !adapter.paused) return;
    miniAutoplayTriedRef.current = true;
    const id = window.setTimeout(() => {
      if (adapter.paused) adapter.play();
    }, 0);
    return () => window.clearTimeout(id);
  }, [
    adapter.canPlay,
    adapter.paused,
    adapter.play,
    miniShouldAutoplay,
    shortsMode,
  ]);

  useEffect(() => {
    const prev = prevPausedRef.current;
    prevPausedRef.current = adapter.paused;
    if (prev == null || prev === adapter.paused) return;
    const next = {
      kind: adapter.paused ? ("pause" as const) : ("play" as const),
      tick: Date.now(),
    };
    setAutoCenterHint(next);
    const t = window.setTimeout(() => setAutoCenterHint(null), 1000);
    return () => window.clearTimeout(t);
  }, [adapter.paused]);

  const {
    hold2xUi,
    suppressNextClickRef,
    onSurfacePointerDown,
    onSurfacePointerUp,
    onSurfacePointerLeave,
  } = usePlayerKeyboardShortcuts({
    adapter,
    shellRef,
    fsActive,
    settingsOpen,
    cinemaMode,
    ping,
    toggleFs,
    onExitCinema,
    onToggleCinema,
    onSettingsOpenChange,
  });

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const onMove = () => ping();
    const onLeave = () => {
      if (!adapter.paused && !settingsOpen) hide();
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("touchstart", onMove, { passive: true });
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      el.removeEventListener("touchstart", onMove);
    };
  }, [shellRef, ping, hide, adapter.paused, settingsOpen]);

  useEffect(() => {
    if (fsActive && cinemaMode) onExitCinema();
  }, [fsActive, cinemaMode, onExitCinema]);

  const onSurfaceClick = (e: ReactMouseEvent) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if ((e.target as HTMLElement).closest("[data-controls]")) return;
    if (settingsOpen) {
      onSettingsOpenChange(false);
      return;
    }
    if (shortsQualityOpen) {
      setShortsQualityOpen(false);
      return;
    }
    adapter.togglePaused();
  };

  const level = adapter.muted ? 0 : adapter.volume;
  const levelUi = hydrated ? level : 1;
  const seekPos = scrub ?? adapter.currentTime;
  const duration = adapter.duration;
  const liveClockOnly = isLive && (!Number.isFinite(duration) || duration <= 0);
  const liveWithDvr =
    isLive && Number.isFinite(duration) && duration > LIVE_EDGE_SECONDS;
  const behindLiveEdge = liveWithDvr && seekPos < duration - LIVE_EDGE_SECONDS;
  const chromeShown = (shortsMode || visible) && !hold2xUi;
  const currentChapterTitle =
    chapters.length > 1
      ? (chapters[chapterIndexAt(chapters, seekPos)]?.title ?? null)
      : null;

  return (
    <>
      {/* Click / dblclick surface (above outlet, below controls) */}
      <button
        type="button"
        data-tap-surface
        aria-label={adapter.paused ? "Play" : "Pause"}
        onClick={onSurfaceClick}
        onPointerDown={onSurfacePointerDown}
        onPointerUp={onSurfacePointerUp}
        onPointerCancel={onSurfacePointerUp}
        onPointerLeave={onSurfacePointerLeave}
        onDoubleClick={shortsMode ? undefined : () => void toggleFs()}
        className="absolute inset-0 z-10 cursor-pointer bg-transparent"
      />

      {/* Buffering spinner */}
      {adapter.waiting && !adapter.paused ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          {/* biome-ignore lint/a11y/useSemanticElements: visual spinner */}
          <div
            className="h-12 w-12 animate-spin rounded-full border-2 border-white/30 border-t-white"
            role="status"
            aria-label="Loading"
          />
        </div>
      ) : null}

      {/* Toggle hint icon (play/pause) */}
      {(centerHint ?? autoCenterHint) && !hold2xUi ? (
        <div
          key={(centerHint ?? autoCenterHint)?.tick}
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
        >
          <div className="flex h-16 w-16 animate-[ot-hint-fade_1000ms_ease-in-out_forwards] items-center justify-center rounded-full bg-black/55 text-white">
            {(centerHint ?? autoCenterHint)?.kind === "play" ? (
              <BigPlayOverlayIcon className="h-10 w-10" />
            ) : (
              <PauseIcon className="h-9 w-9" />
            )}
          </div>
        </div>
      ) : null}

      {hold2xUi ? (
        <div
          className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-md bg-black/45 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums tracking-tight text-white/90 shadow-sm ring-1 ring-white/10"
          aria-live="polite"
        >
          ×2
        </div>
      ) : null}

      {/* Top chrome */}
      {shortsMode ? (
        <>
          <ShortsTopControls
            adapter={adapter}
            levelUi={levelUi}
            chromeShown={chromeShown}
            showVolPanel={showVolPanel}
            onShowVolPanelChange={setShowVolPanel}
          />
          <ShortsQualityPicker
            quality={quality}
            open={shortsQualityOpen}
            onOpenChange={setShortsQualityOpen}
            chromeShown={chromeShown}
          />
        </>
      ) : (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-30 px-4 pt-2 transition-opacity duration-200",
            chromeShown ? "opacity-100" : "opacity-0",
          )}
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))",
            height: "5rem",
          }}
        >
          {!miniMode ? (
            <p className="line-clamp-1 text-sm font-medium text-white drop-shadow">
              {title}
            </p>
          ) : null}
        </div>
      )}

      {/* Bottom chrome */}
      {shortsMode ? (
        <div
          data-controls
          className={cn(
            "absolute inset-x-0 bottom-0 z-30 transition-opacity duration-200",
            chromeShown ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        >
          <ShortsProgressBar
            current={seekPos}
            duration={adapter.duration}
            buffered={adapter.bufferedEnd}
            onScrub={(t) => {
              setScrub(t);
              adapter.seekPreview(t);
            }}
            onScrubEnd={(t) => {
              setScrub(null);
              adapter.seek(t);
            }}
          />
        </div>
      ) : (
        <div
          data-controls
          className={cn(
            "absolute inset-x-0 bottom-0 z-30 transition-opacity duration-200",
            chromeShown ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))",
          }}
        >
          <div className="px-3 pb-2 pt-12 sm:px-4">
            <ProgressBar
              current={seekPos}
              duration={adapter.duration}
              buffered={adapter.bufferedEnd}
              chapters={chapters}
              sponsorSegments={sponsorSegments}
              scrubPreview={scrubPreview ?? null}
              onScrub={(t) => {
                setScrub(t);
                adapter.seekPreview(t);
              }}
              onScrubEnd={(t) => {
                setScrub(null);
                adapter.seek(t);
              }}
            />
            <div className="mt-1 flex items-center gap-1.5 text-white sm:gap-2">
              <button
                type="button"
                onClick={() => adapter.togglePaused()}
                className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15"
                aria-label={adapter.paused ? "Play" : "Pause"}
              >
                {adapter.paused ? (
                  <PlayIcon className="h-6 w-6 pl-0.5" />
                ) : (
                  <PauseIcon className="h-6 w-6" />
                )}
              </button>

              <fieldset
                className="flex items-center border-0 p-0"
                onMouseEnter={() => setShowVolPanel(true)}
                onMouseLeave={() => setShowVolPanel(false)}
                onFocus={() => setShowVolPanel(true)}
                onBlur={() => setShowVolPanel(false)}
              >
                <legend className="sr-only">Volume</legend>
                <button
                  type="button"
                  onClick={() => adapter.toggleMuted()}
                  className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15"
                  aria-label={adapter.muted ? "Unmute" : "Mute"}
                >
                  {levelUi < 0.01 ? (
                    <MuteIcon className="h-6 w-6" />
                  ) : levelUi < 0.5 ? (
                    <VolLowIcon className="h-6 w-6" />
                  ) : (
                    <VolHighIcon className="h-6 w-6" />
                  )}
                </button>
                <div
                  className={cn(
                    "ml-0.5 overflow-hidden transition-[width,opacity] duration-200 ease-out",
                    showVolPanel ? "w-[6.75rem] opacity-100" : "w-0 opacity-0",
                  )}
                >
                  <VolumeSlider
                    value={levelUi}
                    onChange={(v) => adapter.setVolume(v)}
                  />
                </div>
              </fieldset>

              <span className="ml-1 flex min-w-0 items-center gap-2 text-xs text-white/90">
                <span className="flex items-center gap-1.5 font-mono tabular-nums">
                  {liveClockOnly ? (
                    <>
                      <span>{formatClock(seekPos)}</span>
                      <span className="rounded bg-[hsl(var(--primary))] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white">
                        LIVE
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        {formatClock(seekPos)} / {formatClock(duration)}
                      </span>
                      {isLive ? (
                        <span className="rounded bg-[hsl(var(--primary))] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white">
                          LIVE
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
                {currentChapterTitle ? (
                  <>
                    <span aria-hidden className="text-white/40">
                      ·
                    </span>
                    <span
                      className="line-clamp-1 max-w-[14rem] truncate text-white/90 sm:max-w-[22rem]"
                      title={currentChapterTitle}
                    >
                      {currentChapterTitle}
                    </span>
                  </>
                ) : null}
              </span>

              {behindLiveEdge ? (
                <button
                  type="button"
                  onClick={() => adapter.seek(duration)}
                  className="rounded-md bg-[hsl(var(--primary))] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white transition hover:opacity-90"
                >
                  Go to live
                </button>
              ) : null}

              <span className="ml-auto" />

              {miniMode ? (
                <span className="rounded bg-black/35 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/80">
                  Mini
                </span>
              ) : null}

              {nextUp && !miniMode && !shortsMode ? (
                <>
                  <button
                    type="button"
                    onClick={onToggleAutoplayNext}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-medium tracking-wide transition",
                      autoplayNext
                        ? "ot-brand-gradient text-white"
                        : "bg-white/10 text-white/90 hover:bg-white/15",
                    )}
                    aria-pressed={autoplayNext}
                    title="Autoplay next"
                  >
                    Autoplay
                  </button>
                  <button
                    type="button"
                    onClick={onPlayNext}
                    className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15"
                    aria-label="Play next video"
                    title={nextUp.title}
                  >
                    <NextIcon className="h-5 w-5" />
                  </button>
                </>
              ) : null}

              {queue.length > 0 && !miniMode && !shortsMode ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setQueueOpen((v) => !v)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-medium tracking-wide transition",
                      queueOpen
                        ? "bg-white/20 text-white"
                        : "bg-white/10 text-white/90 hover:bg-white/15",
                    )}
                    aria-expanded={queueOpen}
                  >
                    Queue ({queue.length})
                  </button>
                  {queueOpen ? (
                    <div className="absolute bottom-11 right-0 z-50 w-72 max-w-[80vw] rounded-lg border border-white/10 bg-zinc-950/95 p-2 shadow-xl backdrop-blur">
                      <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-zinc-400">
                        Up next
                      </p>
                      <ul className="max-h-64 overflow-auto">
                        {queue.map((item, idx) => (
                          <li key={`${item.href}-${idx}`}>
                            <Link
                              href={item.href}
                              className="line-clamp-2 block rounded-md px-2 py-1.5 text-xs text-zinc-100 hover:bg-white/10"
                              onClick={() => setQueueOpen(false)}
                            >
                              {idx + 1}. {item.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!miniMode && !shortsMode ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => onSettingsOpenChange(!settingsOpen)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15",
                      settingsOpen ? "bg-white/15" : "",
                    )}
                    aria-label="Settings"
                    aria-expanded={settingsOpen}
                  >
                    <GearIcon className="h-5 w-5" />
                  </button>
                </div>
              ) : null}

              {!miniMode && !shortsMode ? (
                <button
                  type="button"
                  onClick={() => onToggleCinema()}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15",
                    cinemaMode ? "bg-white/15 text-white" : "",
                  )}
                  aria-label={
                    cinemaMode ? "Exit cinema mode" : "Enter cinema mode"
                  }
                  aria-pressed={cinemaMode}
                  title="Cinema (C)"
                >
                  <CinemaIcon className="h-5 w-5" />
                </button>
              ) : null}

              {!miniMode && !shortsMode ? (
                <button
                  type="button"
                  onClick={() => void toggleFs()}
                  className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15"
                  aria-label={fsActive ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  {fsActive ? (
                    <FsExitIcon className="h-6 w-6" />
                  ) : (
                    <FsEnterIcon className="h-6 w-6" />
                  )}
                </button>
              ) : null}

              {hydrated && adapter.canPictureInPicture ? (
                <button
                  type="button"
                  onClick={() => adapter.togglePictureInPicture()}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15",
                    adapter.pictureInPicture ? "bg-white/15" : "",
                  )}
                  aria-label={
                    adapter.pictureInPicture
                      ? "Exit picture in picture"
                      : "Enter picture in picture"
                  }
                >
                  <PipIcon className="h-5 w-5" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {settingsOpen && !shortsMode ? (
        <SettingsMenu
          key={
            quality.kind === "progressive"
              ? `p-${quality.items.map((i) => i.label).join("\0")}`
              : quality.kind === "hls-managed"
                ? `h-${quality.items.length}`
                : "none"
          }
          quality={quality}
          audio={audio}
          rate={adapter.playbackRate}
          setRate={(r) => adapter.setPlaybackRate(r)}
          onClose={() => onSettingsOpenChange(false)}
        />
      ) : null}
    </>
  );
}
