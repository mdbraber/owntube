"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePlayerContext } from "@/components/player/player-context";
import { VideoPlayer } from "@/components/player/video-player";
import { cn } from "@/lib/utils";
import { readWatchMiniEnabled } from "@/lib/watch-mini-player-state";

// Position the full-mode overlay before paint (no flash); no-op on the server.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Renders the single, persistent <VideoPlayer> once for the whole app. It stays
 * mounted across navigation and is only repositioned: full-size over the watch
 * page's slot, or a mini corner off the watch page. Because the same instance
 * (and its <video>) is reused, leaving /watch never reloads or re-buffers.
 *
 * Critical: the <VideoPlayer> keeps the same position in the tree in every mode
 * so React never unmounts it — only the wrapper class/geometry changes. Full
 * geometry is applied imperatively so scrolling never re-renders the player.
 */
export function PlayerHost() {
  const { active, slotEl, clearActive } = usePlayerContext();
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [miniEnabled, setMiniEnabled] = useState(true);
  const [entered, setEntered] = useState(false);

  const isShorts = pathname === "/shorts" || pathname.startsWith("/shorts?");
  const onWatch = slotEl !== null;
  const canMini =
    active !== null && !onWatch && !isShorts && active.isAuthed && miniEnabled;

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

  // Off the watch page with mini disabled / signed out → stop and tear down.
  const shouldClear =
    active !== null && !onWatch && (!active.isAuthed || !miniEnabled);
  useEffect(() => {
    if (shouldClear) clearActive();
  }, [shouldClear, clearActive]);

  // Full mode: pin the fixed container over the watch-page slot and keep it
  // matched on scroll / resize / cinema — imperatively, so the player is not
  // re-rendered per frame. Mini/hidden modes clear these inline styles so the
  // className-driven corner positioning takes over.
  useIsoLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!slotEl) {
      el.style.cssText = "";
      return;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const c = containerRef.current;
      if (!c) return;
      const r = slotEl.getBoundingClientRect();
      c.style.position = "fixed";
      c.style.left = `${r.left}px`;
      c.style.top = `${r.top}px`;
      c.style.width = `${r.width}px`;
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
    if (!canMini) {
      setEntered(false);
      return;
    }
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, [canMini]);

  const expand = useCallback(() => {
    if (!active) return;
    const v = containerRef.current?.querySelector<HTMLVideoElement>(
      "[data-ot-player-root] video",
    );
    const t =
      v && Number.isFinite(v.currentTime) ? Math.round(v.currentTime) : 0;
    // The same persistent instance continues; ?t= just overrides history-resume.
    router.push(`/watch/${encodeURIComponent(active.props.videoId)}?t=${t}`);
  }, [active, router]);

  if (!active) return null;
  const mode: "full" | "mini" | "hidden" = onWatch
    ? "full"
    : canMini
      ? "mini"
      : "hidden";
  // Hidden (e.g. on /shorts): don't render. shouldClear covers the signed-out /
  // mini-off case; otherwise the video reappears on the next page.
  if (mode === "hidden") return null;

  return (
    <div
      ref={containerRef}
      className={
        mode === "full"
          ? "z-20 overflow-hidden bg-black"
          : cn(
              // Clear the mobile bottom nav (h-14, shown < 901px); plain bottom-3 on desktop.
              "group fixed bottom-[calc(3.5rem_+_env(safe-area-inset-bottom)_+_0.5rem)] right-3 z-50 w-[min(420px,94vw)] overflow-hidden rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl ring-1 ring-black/5 transition-all duration-300 ease-out min-[901px]:bottom-3",
              entered ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
            )
      }
    >
      <div
        className={
          mode === "mini" ? "relative aspect-video w-full bg-black" : "w-full"
        }
      >
        <VideoPlayer
          key={active.props.videoId}
          {...active.props}
          miniMode={mode === "mini"}
          miniStartPaused={false}
        />
      </div>
      {mode === "mini" ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-end gap-1.5 bg-gradient-to-b from-black/55 to-transparent p-2 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button
            type="button"
            onClick={expand}
            className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label="Expand to full player"
            title="Expand"
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
          <button
            type="button"
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
        </div>
      ) : null}
    </div>
  );
}
