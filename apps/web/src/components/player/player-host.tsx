"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePlayerContext } from "@/components/player/player-context";
import { VideoPlayer } from "@/components/player/video-player";
import { cn } from "@/lib/utils";
import {
  MINI_MAX_WIDTH,
  MINI_MIN_WIDTH,
  type MiniCorner,
  readMiniCorner,
  readMiniWidth,
  readWatchMiniEnabled,
  writeMiniCorner,
  writeMiniWidth,
} from "@/lib/watch-mini-player-state";

/** Gap between the mini player and the viewport / chrome edges. */
const MINI_GAP = 12;

// Position the full-mode overlay before paint (no flash); no-op on the server.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Renders the single, persistent <VideoPlayer> once for the whole app. It stays
 * mounted across navigation and is only repositioned: full-size over the watch
 * page's slot, or a draggable mini corner off the watch page. Because the same
 * instance (and its <video>) is reused, leaving /watch never reloads/re-buffers.
 *
 * The <VideoPlayer> element is memoized so the frequent geometry re-renders
 * (scroll tracking) never re-render the heavy player, and it stays at the same
 * tree position in every mode so React never unmounts it.
 */
export function PlayerHost() {
  const { active, slotEl, clearActive } = usePlayerContext();
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const [miniEnabled, setMiniEnabled] = useState(true);
  const [entered, setEntered] = useState(false);
  // Mini corner (draggable), the measured chrome insets it must clear, and the
  // live drag offset.
  const [corner, setCorner] = useState<MiniCorner>("br");
  const [isMobile, setIsMobile] = useState(false);
  const [insets, setInsets] = useState({ top: 0, bottom: 0 });
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  // Set while we dispatch a synthetic pointerup to the player's tap surface (to
  // cancel its long-press ×2); our own onDragEnd must ignore that echo.
  const clearingHold = useRef(false);
  // Mini width (desktop; aspect-ratio keeps the height), resizable by a corner.
  const [miniWidth, setMiniWidth] = useState<number | null>(null);
  const miniWidthRef = useRef<number | null>(null);
  miniWidthRef.current = miniWidth;
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  // Desktop-only: the inline watch player has scrolled mostly out of view, so
  // it should float as a mini until it scrolls back in. Refs mirror the live
  // values the scroll-driven measure() reads without re-subscribing.
  const [slotOffscreen, setSlotOffscreen] = useState(false);
  const offRef = useRef(false);
  offRef.current = slotOffscreen;
  const insetsRef = useRef({ top: 0, bottom: 0 });

  const isShorts = pathname === "/shorts" || pathname.startsWith("/shorts?");
  const onWatch = slotEl !== null;
  const canMini =
    active !== null && !onWatch && !isShorts && active.isAuthed && miniEnabled;
  // Float the inline watch player once it scrolls off (desktop only).
  const watchScrollMini =
    active !== null && onWatch && !isMobile && miniEnabled && slotOffscreen;
  const showMini = canMini || watchScrollMini;

  // Reflect the "keep mini-player" setting (localStorage, updated in Settings).
  useEffect(() => {
    const load = () => setMiniEnabled(readWatchMiniEnabled(true));
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

  // Restore saved corner + width; track mobile (limits snapping to top/bottom
  // and disables resize).
  useEffect(() => {
    setCorner(readMiniCorner());
    setMiniWidth(readMiniWidth());
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Measure chrome heights so the mini clears the sticky topbar and the mobile
  // bottom nav (display:none — height 0 — on desktop).
  useEffect(() => {
    const measure = () => {
      const topbar = document.querySelector(".ot-shell-topbar");
      const bottomNav = document.querySelector(".ot-shell-bottom-nav");
      const top = topbar?.getBoundingClientRect().height ?? 0;
      const bottom =
        bottomNav && getComputedStyle(bottomNav).display !== "none"
          ? bottomNav.getBoundingClientRect().height
          : 0;
      setInsets({ top, bottom });
      insetsRef.current = { top, bottom };
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Off the watch page with mini disabled / signed out → stop and tear down.
  const shouldClear =
    active !== null && !onWatch && (!active.isAuthed || !miniEnabled);
  useEffect(() => {
    if (shouldClear) clearActive();
  }, [shouldClear, clearActive]);

  // Full mode: track the watch-page slot's viewport box so the overlay matches
  // it (and follows scroll / resize / cinema). Measured before paint.
  useIsoLayoutEffect(() => {
    if (!slotEl) {
      setRect(null);
      setSlotOffscreen(false);
      return;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const r = slotEl.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width });
      // Desktop PiP-on-scroll: float to mini once the inline player is mostly
      // above the fold, and dock back once it's mostly visible again. The band
      // between 40% and 60% visible is hysteresis so it can't flicker.
      const topInset = insetsRef.current.top + MINI_GAP;
      const h = r.height || r.width * (9 / 16);
      if (!offRef.current && r.bottom < topInset + h * 0.4) {
        setSlotOffscreen(true);
      } else if (offRef.current && r.bottom > topInset + h * 0.6) {
        setSlotOffscreen(false);
      }
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(measure);
    };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(slotEl);
    const scroller = document.querySelector(".ot-app-scroll");
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      ro.disconnect();
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, [slotEl]);

  // Mini slide-in.
  useEffect(() => {
    if (!showMini) {
      setEntered(false);
      return;
    }
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, [showMini]);

  const expand = useCallback(() => {
    if (!active) return;
    // Already on the watch page (scroll-mini): just dock back by scrolling the
    // inline slot into view — no navigation, same instance keeps playing.
    if (onWatch) {
      slotEl?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const v = containerRef.current?.querySelector<HTMLVideoElement>(
      "[data-ot-player-root] video",
    );
    const t =
      v && Number.isFinite(v.currentTime) ? Math.round(v.currentTime) : 0;
    // The same persistent instance continues; ?t= just overrides history-resume.
    router.push(`/watch/${encodeURIComponent(active.props.videoId)}?t=${t}`);
  }, [active, onWatch, slotEl, router]);

  // Drag from anywhere on the mini except the player's own controls (marked with
  // data-controls / role=slider / buttons), which keep working. A small movement
  // threshold means a tap still falls through to the player (play/pause).
  const onDragStart = useCallback((e: React.PointerEvent) => {
    // Skip real controls (bottom bar, sliders); the full-surface tap button
    // (data-tap-surface) is draggable — a tap still falls through to play/pause.
    const target = e.target as HTMLElement;
    if (target.closest("[data-controls],[role='slider']") !== null) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragging.current = false;
  }, []);
  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (!dragging.current) {
      if (Math.hypot(dx, dy) < 6) return;
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      // The tap surface armed a long-press ×2 on pointerdown; cancel it so it
      // can't fire mid-drag (its own pointerup won't reach it once we capture).
      const tap =
        containerRef.current?.querySelector<HTMLElement>("[data-tap-surface]");
      if (tap) {
        clearingHold.current = true;
        tap.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerId: e.pointerId,
          }),
        );
      }
    }
    setDrag({ dx, dy });
  }, []);
  const onDragEnd = useCallback(
    (e: React.PointerEvent) => {
      // Ignore the synthetic pointerup we dispatched to cancel the ×2 hold.
      if (clearingHold.current) {
        clearingHold.current = false;
        return;
      }
      if (!dragStart.current) return;
      dragStart.current = null;
      const wasDragging = dragging.current;
      dragging.current = false;
      if (!wasDragging) return; // a tap — let the player handle it
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      const el = containerRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const v = cy < window.innerHeight / 2 ? "t" : "b";
        // Mobile snaps to top/bottom only (near full-width); desktop to any corner.
        const h = isMobile ? "r" : cx < window.innerWidth / 2 ? "l" : "r";
        const next = `${v}${h}` as MiniCorner;
        setCorner(next);
        writeMiniCorner(next);
      }
      setDrag(null);
    },
    [isMobile],
  );

  // Resize the mini by dragging its inner corner (desktop). Width changes toward
  // the free corner; the 16:9 wrapper keeps the height in step.
  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    resizeStart.current = {
      x: e.clientX,
      width: miniWidthRef.current ?? MINI_MIN_WIDTH,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizeStart.current) return;
      const dx = e.clientX - resizeStart.current.x;
      // Anchored on the right → the handle is on the left, so widen by dragging left.
      const dir = corner[1] === "r" ? -1 : 1;
      const max = Math.min(MINI_MAX_WIDTH, window.innerWidth * 0.94);
      const w = Math.max(
        MINI_MIN_WIDTH,
        Math.min(max, resizeStart.current.width + dir * dx),
      );
      setMiniWidth(w);
    },
    [corner],
  );
  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (miniWidthRef.current) writeMiniWidth(miniWidthRef.current);
  }, []);

  const mode: "full" | "mini" | "hidden" = !active
    ? "hidden"
    : showMini
      ? "mini"
      : onWatch
        ? "full"
        : "hidden";

  // Memoized so scroll-driven re-renders here never re-render the player.
  const playerEl = useMemo(
    () =>
      active ? (
        <VideoPlayer
          key={active.props.videoId}
          {...active.props}
          miniMode={mode === "mini"}
          miniStartPaused={false}
        />
      ) : null,
    [active, mode],
  );

  if (!active || mode === "hidden") return null;

  const effCorner: MiniCorner = isMobile
    ? (`${corner[0]}r` as MiniCorner)
    : corner;
  let style: React.CSSProperties;
  if (mode === "full") {
    style = rect
      ? { position: "fixed", left: rect.left, top: rect.top, width: rect.width }
      : { position: "fixed", left: 0, top: 0, width: 0, opacity: 0 };
  } else {
    style = { position: "fixed" };
    if (effCorner[0] === "t") style.top = insets.top + MINI_GAP;
    else style.bottom = insets.bottom + MINI_GAP;
    if (effCorner[1] === "l") style.left = MINI_GAP;
    else style.right = MINI_GAP;
    if (!isMobile && miniWidth) style.width = miniWidth;
    if (drag) {
      style.transform = `translate(${drag.dx}px, ${drag.dy}px)`;
      style.transition = "none";
    }
  }

  const dragProps =
    mode === "mini"
      ? {
          onPointerDown: onDragStart,
          onPointerMove: onDragMove,
          onPointerUp: onDragEnd,
          onPointerCancel: onDragEnd,
        }
      : {};

  return (
    <div
      ref={containerRef}
      style={style}
      {...dragProps}
      className={
        mode === "full"
          ? "z-20 overflow-hidden bg-black"
          : cn(
              "group z-50 w-[min(420px,94vw)] cursor-move touch-none overflow-hidden rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl ring-1 ring-black/5 transition-opacity duration-300",
              entered ? "opacity-100" : "opacity-0",
            )
      }
    >
      <div
        className={
          mode === "mini" ? "relative aspect-video w-full bg-black" : "w-full"
        }
      >
        {playerEl}
      </div>
      {mode === "mini" ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-end gap-1.5 bg-gradient-to-b from-black/55 to-transparent p-2 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={expand}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label={
              onWatch ? "Back to full player" : "Expand to full player"
            }
            title={onWatch ? "Back to player" : "Expand"}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden
            >
              <title>Expand</title>
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
          {onWatch ? null : (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={clearActive}
              className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label="Close mini player"
              title="Close"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
                aria-hidden
              >
                <title>Close</title>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      ) : null}
      {mode === "mini" && !isMobile ? (
        <button
          type="button"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          className={cn(
            "absolute z-20 h-5 w-5 touch-none bg-transparent",
            resizeHandlePos[effCorner],
          )}
          aria-label="Resize mini player"
          title="Drag to resize"
        />
      ) : null}
    </div>
  );
}

/** Resize grip corner (opposite the anchored corner) + the matching cursor. */
const resizeHandlePos: Record<MiniCorner, string> = {
  br: "left-0 top-0 cursor-nwse-resize",
  bl: "right-0 top-0 cursor-nesw-resize",
  tr: "left-0 bottom-0 cursor-nesw-resize",
  tl: "right-0 bottom-0 cursor-nwse-resize",
};
