"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PlayerAdapter } from "@/components/player/player-types";

/**
 * Player keyboard shortcuts + pointer/space long-press ×2. Owns the ×2 lease,
 * the click-suppression latch, and the tap-surface pointer handlers so the
 * chrome component only wires them onto the surface and reads `hold2xUi`.
 */
/** Keys the watch page's player takes even while focus is elsewhere. */
const PAGE_KEYS = new Set([
  " ",
  "k",
  "j",
  "l",
  "arrowleft",
  "arrowright",
  "m",
  "f",
  "c",
  "i",
]);

/** Elements that use these keys themselves (typing, sliders, menus, tabs). */
function ownsKeys(el: HTMLElement): boolean {
  if (
    el.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT", "VIDEO", "AUDIO"].includes(el.tagName)
  ) {
    return true;
  }
  const role = el.getAttribute("role") ?? "";
  if (
    /^(slider|spinbutton|listbox|option|menu|menuitem|menuitemcheckbox|menuitemradio|tab|tablist|radio|radiogroup|combobox|textbox|grid|tree|treeitem)$/.test(
      role,
    )
  ) {
    return true;
  }
  return Boolean(el.closest('[role="dialog"],[aria-modal="true"]'));
}

export function usePlayerKeyboardShortcuts(opts: {
  adapter: PlayerAdapter;
  shellRef: React.RefObject<HTMLDivElement | null>;
  fsActive: boolean;
  settingsOpen: boolean;
  cinemaMode: boolean;
  ping: () => void;
  toggleFs: () => Promise<void> | void;
  onExitCinema: () => void;
  onToggleCinema: () => void;
  onSettingsOpenChange: (open: boolean) => void;
  /**
   * Seek by `delta` seconds from a key (← → J L); the chrome seeks and shows
   * the seek marker. Falls back to a plain seek.
   */
  onSeekKey?: (delta: number) => void;
  /**
   * A seek key held down (its auto-repeat): scrub toward `dir` until
   * `onSeekHoldEnd` (the key's release, or the window losing focus).
   */
  onSeekHold?: (dir: -1 | 1) => void;
  onSeekHoldEnd?: () => void;
  /**
   * The page's main player (watch page): its shortcuts also work while focus
   * is elsewhere on the page, as on YouTube, unless a field or another
   * control that uses the keys has it.
   */
  globalShortcuts?: boolean;
}) {
  const {
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
  } = opts;
  const globalShortcuts = opts.globalShortcuts ?? false;
  // A ref: the chrome passes a fresh callback each render.
  const onSeekKeyRef = useRef(opts.onSeekKey);
  onSeekKeyRef.current = opts.onSeekKey;
  const onSeekHoldRef = useRef(opts.onSeekHold);
  onSeekHoldRef.current = opts.onSeekHold;
  const onSeekHoldEndRef = useRef(opts.onSeekHoldEnd);
  onSeekHoldEndRef.current = opts.onSeekHoldEnd;
  // The seek key being held (its auto-repeat took over), if any.
  const heldSeekKeyRef = useRef<string | null>(null);

  /** True while long-press 2× is active: hides chrome, shows a small ×2 hint. */
  const [hold2xUi, setHold2xUi] = useState(false);

  const hold2xTimerRef = useRef<number | null>(null);
  const holding2xRef = useRef(false);
  const rateBeforeHoldRef = useRef(1);
  const suppressNextClickRef = useRef(false);

  /** ×2 UI can be held by pointer long-press and/or Space long-press — ref-counted. */
  const hold2xLeaseRef = useRef(0);
  const acquireHold2xLease = useCallback(() => {
    hold2xLeaseRef.current += 1;
    if (hold2xLeaseRef.current === 1) setHold2xUi(true);
  }, []);
  const releaseHold2xLease = useCallback(() => {
    hold2xLeaseRef.current = Math.max(0, hold2xLeaseRef.current - 1);
    if (hold2xLeaseRef.current === 0) setHold2xUi(false);
  }, []);

  const clearHold2xTimer = useCallback(() => {
    if (hold2xTimerRef.current != null) {
      window.clearTimeout(hold2xTimerRef.current);
      hold2xTimerRef.current = null;
    }
  }, []);

  const spacePhysDownRef = useRef(false);
  const spaceHoldTimerRef = useRef<number | null>(null);
  const spaceHold2xEngagedRef = useRef(false);
  const rateBeforeSpaceHoldRef = useRef(1);

  const clearSpaceHoldTimer = useCallback(() => {
    if (spaceHoldTimerRef.current != null) {
      window.clearTimeout(spaceHoldTimerRef.current);
      spaceHoldTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearHold2xTimer(), [clearHold2xTimer]);

  const onSurfacePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-controls]")) return;
      if (settingsOpen) return;
      // Long-press ×2 only for real pointing devices (not keyboard/synthetic).
      if (
        e.pointerType !== "mouse" &&
        e.pointerType !== "pen" &&
        e.pointerType !== "touch"
      ) {
        return;
      }
      if (!e.isPrimary) return;
      rateBeforeHoldRef.current = adapter.playbackRate;
      clearHold2xTimer();
      hold2xTimerRef.current = window.setTimeout(() => {
        hold2xTimerRef.current = null;
        holding2xRef.current = true;
        adapter.setPlaybackRate(2);
        acquireHold2xLease();
      }, 220);
    },
    [adapter, acquireHold2xLease, settingsOpen, clearHold2xTimer],
  );

  const onSurfacePointerUp = useCallback(() => {
    clearHold2xTimer();
    if (holding2xRef.current) {
      holding2xRef.current = false;
      releaseHold2xLease();
      suppressNextClickRef.current = true;
      adapter.setPlaybackRate(rateBeforeHoldRef.current);
    }
  }, [adapter, clearHold2xTimer, releaseHold2xLease]);

  const onSurfacePointerLeave = useCallback(() => {
    clearHold2xTimer();
    if (holding2xRef.current) {
      holding2xRef.current = false;
      releaseHold2xLease();
      suppressNextClickRef.current = true;
      adapter.setPlaybackRate(rateBeforeHoldRef.current);
    }
  }, [adapter, clearHold2xTimer, releaseHold2xLease]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    const releaseSpaceHoldIfNeeded = () => {
      clearSpaceHoldTimer();
      if (!spacePhysDownRef.current) return;
      spacePhysDownRef.current = false;
      if (spaceHold2xEngagedRef.current) {
        spaceHold2xEngagedRef.current = false;
        adapter.setPlaybackRate(rateBeforeSpaceHoldRef.current);
        releaseHold2xLease();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (
        heldSeekKeyRef.current &&
        e.key.toLowerCase() === heldSeekKeyRef.current
      ) {
        heldSeekKeyRef.current = null;
        onSeekHoldEndRef.current?.();
        return;
      }
      if (e.code !== "Space" && e.key !== " ") return;
      // Only a space press this handler took (keydown set this) — finish it
      // wherever focus is now.
      if (!spacePhysDownRef.current) return;
      e.preventDefault();
      spacePhysDownRef.current = false;
      clearSpaceHoldTimer();
      if (spaceHold2xEngagedRef.current) {
        spaceHold2xEngagedRef.current = false;
        adapter.setPlaybackRate(rateBeforeSpaceHoldRef.current);
        releaseHold2xLease();
      } else {
        adapter.togglePaused();
        ping();
      }
    };

    const onWinBlur = () => {
      if (heldSeekKeyRef.current) {
        heldSeekKeyRef.current = null;
        onSeekHoldEndRef.current?.();
      }
      clearSpaceHoldTimer();
      if (!spacePhysDownRef.current) return;
      spacePhysDownRef.current = false;
      if (spaceHold2xEngagedRef.current) {
        spaceHold2xEngagedRef.current = false;
        adapter.setPlaybackRate(rateBeforeSpaceHoldRef.current);
        releaseHold2xLease();
      }
    };

    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const inPlayer =
        Boolean(shellRef.current?.contains(document.activeElement)) || fsActive;
      if (!inPlayer) {
        if (!globalShortcuts || !PAGE_KEYS.has(key)) return;
        const active = document.activeElement;
        // Space on the page only when nothing is focused (on a button it
        // presses the button); the rest unless a control owns the keys.
        if (key === " " && active && active !== document.body) return;
        if (active instanceof HTMLElement && ownsKeys(active)) return;
      }
      if (key === "escape") {
        releaseSpaceHoldIfNeeded();
        if (settingsOpen) {
          e.preventDefault();
          onSettingsOpenChange(false);
          ping();
        } else if (cinemaMode) {
          e.preventDefault();
          onExitCinema();
          ping();
        }
        return;
      }
      if (key === " ") {
        e.preventDefault();
        if (e.repeat) return;
        clearHold2xTimer();
        rateBeforeSpaceHoldRef.current = adapter.playbackRate;
        spacePhysDownRef.current = true;
        spaceHold2xEngagedRef.current = false;
        clearSpaceHoldTimer();
        spaceHoldTimerRef.current = window.setTimeout(() => {
          spaceHoldTimerRef.current = null;
          spaceHold2xEngagedRef.current = true;
          adapter.setPlaybackRate(2);
          acquireHold2xLease();
        }, 220);
        return;
      }
      if (key === "k") {
        e.preventDefault();
        if (e.repeat) return;
        adapter.togglePaused();
        ping();
        return;
      }
      if (
        key === "arrowleft" ||
        key === "j" ||
        key === "arrowright" ||
        key === "l"
      ) {
        e.preventDefault();
        const backward = key === "arrowleft" || key === "j";
        if (e.repeat) {
          // Held: scrub instead of a burst of separate seeks.
          if (onSeekHoldRef.current && heldSeekKeyRef.current !== key) {
            heldSeekKeyRef.current = key;
            onSeekHoldRef.current(backward ? -1 : 1);
          }
          if (onSeekHoldRef.current) return;
        }
        const step = key === "j" || key === "l" ? 10 : 5;
        const delta = backward ? -step : step;
        const onSeekKey = onSeekKeyRef.current;
        if (onSeekKey) onSeekKey(delta);
        else {
          const d = adapter.duration;
          const t = adapter.currentTime + delta;
          adapter.seek(
            Math.max(0, Number.isFinite(d) && d > 0 ? Math.min(t, d) : t),
          );
          ping();
        }
      } else if (key === "arrowup") {
        e.preventDefault();
        adapter.setVolume(
          Math.min(1, (adapter.muted ? 0 : adapter.volume) + 0.05),
        );
        ping();
      } else if (key === "arrowdown") {
        e.preventDefault();
        adapter.setVolume(
          Math.max(0, (adapter.muted ? 0 : adapter.volume) - 0.05),
        );
        ping();
      } else if (key === "m") {
        e.preventDefault();
        adapter.toggleMuted();
        ping();
      } else if (key === "f") {
        e.preventDefault();
        void toggleFs();
      } else if (key === "c") {
        e.preventDefault();
        onToggleCinema();
        ping();
      } else if (key === "i") {
        e.preventDefault();
        adapter.togglePictureInPicture();
      }
    };
    window.addEventListener("keydown", handler, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWinBlur);
    return () => {
      window.removeEventListener("keydown", handler, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onWinBlur);
    };
  }, [
    acquireHold2xLease,
    adapter,
    cinemaMode,
    clearHold2xTimer,
    clearSpaceHoldTimer,
    fsActive,
    onExitCinema,
    onToggleCinema,
    ping,
    releaseHold2xLease,
    settingsOpen,
    shellRef,
    toggleFs,
    onSettingsOpenChange,
    globalShortcuts,
  ]);

  return {
    hold2xUi,
    suppressNextClickRef,
    onSurfacePointerDown,
    onSurfacePointerUp,
    onSurfacePointerLeave,
  };
}
