"use client";

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { CaptionModel } from "@/components/player/player-captions";
import {
  CHAPTER_GAP_PX,
  formatClock,
  PLAYBACK_RATES,
} from "@/components/player/player-constants";
import {
  MuteIcon,
  VolHighIcon,
  VolLowIcon,
} from "@/components/player/player-icons";
import {
  type AudioModel,
  type QualityModel,
  qualityShortLabel,
} from "@/components/player/player-quality";
import type { PlayerAdapter } from "@/components/player/player-types";
import { ScrubPreviewOverlay } from "@/components/player/scrub-preview";
import type { ScrubPreviewConfig } from "@/hooks/use-scrub-frame-preview";
import {
  categoryLabel,
  type SponsorBlockSegment,
  segmentAtTime,
} from "@/lib/sponsorblock";
import { cn } from "@/lib/utils";
import { chapterIndexAt, type VideoChapter } from "@/lib/video-chapters";

type SettingsView = "root" | "speed" | "quality" | "audio" | "captions";

/** Menu label for the currently selected caption track (or "Off"). */
function captionsShortLabel(captions: CaptionModel): string {
  if (captions.kind !== "tracks" || captions.activeIndex === null) return "Off";
  return captions.items[captions.activeIndex]?.label ?? "Off";
}

export function SettingsMenu({
  quality,
  audio,
  captions,
  rate,
  setRate,
  onClose,
  variant = "popover",
}: {
  quality: QualityModel;
  audio: AudioModel;
  captions: CaptionModel;
  rate: number;
  setRate: (r: number) => void;
  onClose: () => void;
  /** "embedded" drops the popover positioning/chrome so the same menu can sit inside the mobile sheet. */
  variant?: "popover" | "embedded";
}) {
  const [view, setView] = useState<SettingsView>("root");
  useEffect(() => {
    if (audio.kind === "none" && view === "audio") setView("root");
    if (captions.kind === "none" && view === "captions") setView("root");
  }, [audio.kind, captions.kind, view]);
  return (
    <div
      className={
        variant === "embedded"
          ? "w-full overflow-hidden text-sm"
          : "absolute bottom-14 right-3 z-40 w-56 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/95 text-sm shadow-xl backdrop-blur-md"
      }
      onClick={(e: ReactMouseEvent) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="menu"
      tabIndex={-1}
    >
      {view === "root" ? (
        <ul className="py-1">
          <li>
            <button
              type="button"
              onClick={() => setView("speed")}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-zinc-100 hover:bg-white/10"
            >
              <span>Playback speed</span>
              <span className="text-xs text-zinc-400">
                {rate === 1 ? "Normal" : `${rate}×`}
              </span>
            </button>
          </li>
          {quality.kind !== "none" ? (
            <li>
              <button
                type="button"
                onClick={() => setView("quality")}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-zinc-100 hover:bg-white/10"
              >
                <span>Quality</span>
                <span className="text-xs text-zinc-400">
                  {quality.kind === "progressive"
                    ? (quality.items[quality.index]?.label ?? "")
                    : ""}
                </span>
              </button>
            </li>
          ) : null}
          {audio.kind !== "none" ? (
            <li>
              <button
                type="button"
                onClick={() => setView("audio")}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-zinc-100 hover:bg-white/10"
              >
                <span>Language</span>
                <span className="text-xs text-zinc-400">
                  {audio.kind === "split-native"
                    ? (audio.items[audio.index]?.label ?? "")
                    : ""}
                </span>
              </button>
            </li>
          ) : null}
          {captions.kind === "tracks" ? (
            <li>
              <button
                type="button"
                onClick={() => setView("captions")}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-zinc-100 hover:bg-white/10"
              >
                <span>Subtitles/CC</span>
                <span className="text-xs text-zinc-400">
                  {captionsShortLabel(captions)}
                </span>
              </button>
            </li>
          ) : null}
          {variant === "popover" ? (
            <li className="border-t border-white/10">
              <button
                type="button"
                onClick={onClose}
                className="w-full px-3 py-2 text-left text-xs text-zinc-400 hover:bg-white/10"
              >
                Close
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {view === "speed" ? (
        <div>
          <div className="border-b border-white/10 px-3 py-2 text-xs uppercase tracking-wider text-zinc-400">
            <button
              type="button"
              onClick={() => setView("root")}
              className="hover:underline"
            >
              ‹ Speed
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {PLAYBACK_RATES.map((r) => (
              <li key={r}>
                <button
                  type="button"
                  onClick={() => {
                    setRate(r);
                    setView("root");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/10",
                    r === rate ? "text-[hsl(var(--primary))]" : "text-zinc-100",
                  )}
                >
                  <span>{r === 1 ? "Normal" : `${r}×`}</span>
                  {r === rate ? <span aria-hidden>✓</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view === "quality" && quality.kind !== "none" ? (
        <div>
          <div className="border-b border-white/10 px-3 py-2 text-xs uppercase tracking-wider text-zinc-400">
            <button
              type="button"
              onClick={() => setView("root")}
              className="hover:underline"
            >
              ‹ Quality
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {quality.kind === "progressive"
              ? quality.items.map((it, i) => (
                  <li key={`${it.label}-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        quality.setIndex(i);
                        setView("root");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/10",
                        i === quality.index
                          ? "text-[hsl(var(--primary))]"
                          : "text-zinc-100",
                      )}
                    >
                      <span>{it.label}</span>
                      {i === quality.index ? <span aria-hidden>✓</span> : null}
                    </button>
                  </li>
                ))
              : null}
          </ul>
        </div>
      ) : null}
      {view === "audio" && audio.kind !== "none" ? (
        <div>
          <div className="border-b border-white/10 px-3 py-2 text-xs uppercase tracking-wider text-zinc-400">
            <button
              type="button"
              onClick={() => setView("root")}
              className="hover:underline"
            >
              ‹ Language
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {audio.kind === "split-native"
              ? audio.items.map((it, i) => (
                  <li key={`${it.label}-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        audio.setIndex(i);
                        setView("root");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/10",
                        i === audio.index
                          ? "text-[hsl(var(--primary))]"
                          : "text-zinc-100",
                      )}
                    >
                      <span>{it.label}</span>
                      {i === audio.index ? <span aria-hidden>✓</span> : null}
                    </button>
                  </li>
                ))
              : null}
          </ul>
        </div>
      ) : null}
      {view === "captions" && captions.kind === "tracks" ? (
        <div>
          <div className="border-b border-white/10 px-3 py-2 text-xs uppercase tracking-wider text-zinc-400">
            <button
              type="button"
              onClick={() => setView("root")}
              className="hover:underline"
            >
              ‹ Subtitles/CC
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  captions.setActive(null);
                  setView("root");
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/10",
                  captions.activeIndex === null
                    ? "text-[hsl(var(--primary))]"
                    : "text-zinc-100",
                )}
              >
                <span>Off</span>
                {captions.activeIndex === null ? (
                  <span aria-hidden>✓</span>
                ) : null}
              </button>
            </li>
            {captions.items.map((it, i) => (
              <li key={`${it.languageCode}-${it.label}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    captions.setActive(i);
                    setView("root");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/10",
                    i === captions.activeIndex
                      ? "text-[hsl(var(--primary))]"
                      : "text-zinc-100",
                  )}
                >
                  <span>{it.label}</span>
                  {i === captions.activeIndex ? (
                    <span aria-hidden>✓</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function VolumeSlider({
  value,
  onChange,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  id?: string;
}) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div className="relative flex h-8 w-[6.5rem] shrink-0 items-center">
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] ring-1 ring-black/40"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-0 top-1/2 h-2 max-w-full -translate-y-1/2 rounded-l-full bg-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
        style={{ width: `${pct}%` }}
        aria-hidden
      />
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-[0.02]"
        aria-label="Volume"
      />
    </div>
  );
}

export function ProgressBar({
  current,
  duration,
  buffered,
  chapters,
  sponsorSegments = [],
  scrubPreview,
  completed = false,
  onScrub,
  onScrubEnd,
}: {
  current: number;
  duration: number;
  buffered: number;
  chapters: VideoChapter[];
  sponsorSegments?: SponsorBlockSegment[];
  scrubPreview?: ScrubPreviewConfig | null;
  /** Watched video: paint the played fill green, matching the card's bar. */
  completed?: boolean;
  onScrub: (t: number) => void;
  onScrubEnd: (t: number) => void;
}) {
  // The played portion (and scrub handle) go emerald once a video is watched,
  // mirroring the completed watch-progress bar on cards; brand gradient
  // otherwise.
  const playedClass = completed ? "bg-emerald-500" : "ot-brand-gradient";
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  // Portal target must follow the fullscreen element: in fullscreen the player
  // shell becomes its own stacking context, so anything left on `document.body`
  // renders *behind* it (z-index is inert across stacking contexts).
  const [fsEl, setFsEl] = useState<Element | null>(null);
  useEffect(() => {
    const onChange = () => setFsEl(document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const syncHoverAnchor = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setHoverAnchor({ x: clientX, y: rect.top });
  }, []);

  const pct = (n: number) =>
    duration > 0 ? Math.min(100, Math.max(0, (n / duration) * 100)) : 0;

  const tFromPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const x = Math.min(rect.right, Math.max(rect.left, clientX));
      const ratio = (x - rect.left) / Math.max(rect.width, 1);
      return ratio * duration;
    },
    [duration],
  );

  const onPointerDown = (e: ReactPointerEvent) => {
    if (duration <= 0) return;
    scrubPreview?.primeFrames?.();
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    const t = tFromPointer(e.clientX);
    setHover(t);
    syncHoverAnchor(e.clientX);
    onScrub(t);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    scrubPreview?.primeFrames?.();
    const t = tFromPointer(e.clientX);
    setHover(t);
    syncHoverAnchor(e.clientX);
    if (draggingRef.current) onScrub(t);
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    const t = tFromPointer(e.clientX);
    onScrubEnd(t);
  };

  useEffect(() => {
    if (!dragging) return;
    const onWinPointerMove = (e: PointerEvent) => {
      const t = tFromPointer(e.clientX);
      setHover(t);
      syncHoverAnchor(e.clientX);
      if (draggingRef.current) onScrub(t);
    };
    const finish = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      const t = tFromPointer(e.clientX);
      onScrubEnd(t);
    };
    window.addEventListener("pointermove", onWinPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onWinPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [dragging, onScrub, onScrubEnd, syncHoverAnchor, tFromPointer]);

  const hasChapters = chapters.length > 1;
  const hoverChapterIndex = useMemo(
    () =>
      hover !== null && hasChapters ? chapterIndexAt(chapters, hover) : -1,
    [chapters, hover, hasChapters],
  );
  const hoverChapterTitle =
    hoverChapterIndex >= 0
      ? (chapters[hoverChapterIndex]?.title ?? null)
      : null;
  const hoverSponsorSegment =
    hover !== null && sponsorSegments.length > 0
      ? segmentAtTime(sponsorSegments, hover)
      : null;
  const hoverSponsorLabel = hoverSponsorSegment
    ? categoryLabel(hoverSponsorSegment.category)
    : null;

  return (
    <div
      ref={trackRef}
      className="group/scrub relative flex min-h-10 cursor-pointer select-none items-center overflow-visible py-1.5 pointer-events-auto"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setHover(null);
        setHoverAnchor(null);
      }}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.max(duration, 1)}
      aria-valuenow={Math.min(current, Math.max(duration, 1))}
      tabIndex={0}
    >
      {hasChapters ? (
        chapters.map((chapter, index) => {
          const next = chapters[index + 1];
          const chapterEnd = next?.startSeconds ?? duration;
          const widthSeconds = Math.max(0, chapterEnd - chapter.startSeconds);
          const left = pct(chapter.startSeconds);
          const width = pct(widthSeconds);
          const isLast = index === chapters.length - 1;
          const isHovered = hoverChapterIndex === index;
          const localBuffered =
            widthSeconds > 0
              ? Math.min(
                  100,
                  Math.max(
                    0,
                    ((buffered - chapter.startSeconds) / widthSeconds) * 100,
                  ),
                )
              : 0;
          const localProgress =
            widthSeconds > 0
              ? Math.min(
                  100,
                  Math.max(
                    0,
                    ((current - chapter.startSeconds) / widthSeconds) * 100,
                  ),
                )
              : 0;
          return (
            <div
              key={`chapter-${chapter.startSeconds}-${index}`}
              className={cn(
                "pointer-events-none absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-[height] duration-150",
                isHovered ? "h-2" : "h-1 group-hover/scrub:h-1.5",
              )}
              style={{
                left: `${left}%`,
                width: isLast
                  ? `${width}%`
                  : `calc(${width}% - ${CHAPTER_GAP_PX}px)`,
              }}
              aria-hidden
            >
              <div
                className="absolute inset-y-0 left-0 bg-white/40"
                style={{ width: `${localBuffered}%` }}
              />
              <div
                className={cn("absolute inset-y-0 left-0", playedClass)}
                style={{ width: `${localProgress}%` }}
              />
            </div>
          );
        })
      ) : (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/25 transition-[height] group-hover/scrub:h-1.5" />
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full"
            aria-hidden
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white/40"
              style={{ width: `${pct(buffered)}%` }}
            />
            <div
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                playedClass,
              )}
              style={{ width: `${pct(current)}%` }}
            />
          </div>
        </>
      )}
      {sponsorSegments.length > 0 && duration > 0
        ? sponsorSegments.map((seg) => {
            const left = pct(seg.startSeconds);
            const width = pct(seg.endSeconds - seg.startSeconds);
            return (
              <div
                key={`sb-${seg.uuid}`}
                className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-sm bg-[hsl(var(--primary))]/55 ring-1 ring-[hsl(var(--primary))]/30"
                style={{
                  left: `${left}%`,
                  width: `${Math.max(width, 0.35)}%`,
                }}
                aria-hidden
              />
            );
          })
        : null}
      {hover !== null && hoverAnchor && typeof document !== "undefined"
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[80] flex w-max shrink-0 flex-col items-center gap-1"
              style={{
                left: hoverAnchor.x,
                top: hoverAnchor.y,
                transform: "translate(-50%, calc(-100% - 0.375rem))",
              }}
            >
              {scrubPreview ? (
                <ScrubPreviewOverlay
                  hover={hover}
                  duration={duration}
                  scrubPreview={scrubPreview}
                />
              ) : null}
              {hoverSponsorLabel ? (
                <span className="max-w-[16rem] truncate rounded-md bg-[hsl(var(--primary))]/90 px-2 py-0.5 text-[11px] font-medium text-white shadow ring-1 ring-white/10">
                  {hoverSponsorLabel}
                </span>
              ) : null}
              {hoverChapterTitle ? (
                <span className="max-w-[16rem] truncate rounded-md bg-black/85 px-2 py-0.5 text-[11px] font-medium text-white shadow ring-1 ring-white/10">
                  {hoverChapterTitle}
                </span>
              ) : null}
              <span className="rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white shadow ring-1 ring-white/10">
                {formatClock(hover)}
              </span>
            </div>,
            (fsEl as HTMLElement | null) ?? document.body,
          )
        : null}
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 shadow ring-2 ring-black/40 transition-opacity group-hover/scrub:opacity-100",
          playedClass,
        )}
        style={{ left: `${pct(current)}%` }}
        aria-hidden
      />
    </div>
  );
}

export function ShortsProgressBar({
  current,
  duration,
  buffered,
  onScrub,
  onScrubEnd,
}: {
  current: number;
  duration: number;
  buffered: number;
  onScrub: (t: number) => void;
  onScrubEnd: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const pct = (n: number) =>
    duration > 0 ? Math.min(100, Math.max(0, (n / duration) * 100)) : 0;

  const tFromPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const x = Math.min(rect.right, Math.max(rect.left, clientX));
      const ratio = (x - rect.left) / Math.max(rect.width, 1);
      return ratio * duration;
    },
    [duration],
  );

  const onPointerDown = (e: ReactPointerEvent) => {
    if (duration <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    onScrub(tFromPointer(e.clientX));
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return;
    onScrub(tFromPointer(e.clientX));
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    onScrubEnd(tFromPointer(e.clientX));
  };

  useEffect(() => {
    if (!dragging) return;
    const onWinPointerMove = (e: PointerEvent) => {
      if (draggingRef.current) onScrub(tFromPointer(e.clientX));
    };
    const finish = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      onScrubEnd(tFromPointer(e.clientX));
    };
    window.addEventListener("pointermove", onWinPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onWinPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [dragging, onScrub, onScrubEnd, tFromPointer]);

  return (
    <div
      ref={trackRef}
      className="relative flex h-4 w-full cursor-pointer select-none items-end pointer-events-auto"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.max(duration, 1)}
      aria-valuenow={Math.min(current, Math.max(duration, 1))}
      tabIndex={0}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/25">
        <div
          className="absolute inset-y-0 left-0 bg-white/40"
          style={{ width: `${pct(buffered)}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 ot-brand-gradient"
          style={{ width: `${pct(current)}%` }}
        />
      </div>
    </div>
  );
}

export function ShortsTopControls({
  adapter,
  levelUi,
  chromeShown,
  showVolPanel,
  onShowVolPanelChange,
}: {
  adapter: PlayerAdapter;
  levelUi: number;
  chromeShown: boolean;
  showVolPanel: boolean;
  onShowVolPanelChange: (open: boolean) => void;
}) {
  const volSliderVisible = chromeShown && showVolPanel;

  return (
    <div
      data-controls
      className={cn(
        "pointer-events-auto absolute left-2 top-2 z-30 flex max-w-[calc(100%-1rem)] items-center gap-1 transition-opacity duration-200 sm:left-3 sm:top-3",
        chromeShown ? "opacity-100" : "opacity-0",
      )}
    >
      {/* Play/pause lives on the center tap button now — top-left keeps only
          the volume control. */}
      <fieldset
        className="flex min-w-0 items-center rounded-full border-0 bg-black/45 px-0.5"
        onMouseEnter={() => onShowVolPanelChange(true)}
        onMouseLeave={() => onShowVolPanelChange(false)}
        onFocus={() => onShowVolPanelChange(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            onShowVolPanelChange(false);
          }
        }}
        onPointerDown={() => onShowVolPanelChange(true)}
      >
        <legend className="sr-only">Volume</legend>
        <button
          type="button"
          onClick={() => adapter.toggleMuted()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition hover:bg-black/60"
          aria-label={adapter.muted ? "Unmute" : "Mute"}
        >
          {levelUi < 0.01 ? (
            <MuteIcon className="h-5 w-5" />
          ) : levelUi < 0.5 ? (
            <VolLowIcon className="h-5 w-5" />
          ) : (
            <VolHighIcon className="h-5 w-5" />
          )}
        </button>
        <div
          className={cn(
            "overflow-hidden transition-[width,opacity] duration-200 ease-out",
            volSliderVisible ? "w-[6.75rem] opacity-100" : "w-0 opacity-0",
          )}
        >
          <VolumeSlider
            value={levelUi}
            onChange={(v) => adapter.setVolume(v)}
          />
        </div>
      </fieldset>
    </div>
  );
}

export function ShortsQualityPicker({
  quality,
  open,
  onOpenChange,
  chromeShown,
}: {
  quality: QualityModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chromeShown: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  if (quality.kind === "none") return null;

  return (
    <div
      ref={rootRef}
      data-controls
      className={cn(
        // Below 901px the shorts exit cross owns the top-right corner, so sit to
        // its left; back to the corner at ≥901px where the cross is hidden.
        "pointer-events-auto absolute right-14 top-2 z-30 transition-opacity duration-200 min-[901px]:right-3 min-[901px]:top-3",
        chromeShown ? "opacity-100" : "opacity-0",
      )}
    >
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black/60",
          open && "bg-black/60",
        )}
        aria-label="Quality"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {qualityShortLabel(quality)}
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Quality"
          className="absolute right-0 top-full z-40 mt-1 max-h-64 w-44 overflow-y-auto rounded-lg border border-white/10 bg-zinc-950/95 py-1 text-sm shadow-xl backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {quality.kind === "progressive"
            ? quality.items.map((it, i) => (
                <button
                  key={`${it.label}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === quality.index}
                  onClick={() => {
                    quality.setIndex(i);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white/10",
                    i === quality.index
                      ? "text-[hsl(var(--primary))]"
                      : "text-zinc-100",
                  )}
                >
                  <span>{it.label}</span>
                  {i === quality.index ? <span aria-hidden>✓</span> : null}
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
