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
      if (e.code !== "Space" && e.key !== " ") return;
      if (!spacePhysDownRef.current) return;
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable)
      ) {
        return;
      }
      if (!shellRef.current?.contains(document.activeElement) && !fsActive) {
        return;
      }
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
      if (!shellRef.current?.contains(document.activeElement) && !fsActive) {
        return;
      }
      const key = e.key.toLowerCase();
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
      if (key === "arrowleft" || key === "j") {
        e.preventDefault();
        adapter.seek(Math.max(0, adapter.currentTime - (key === "j" ? 10 : 5)));
        ping();
      } else if (key === "arrowright" || key === "l") {
        e.preventDefault();
        adapter.seek(
          Math.min(
            adapter.duration || adapter.currentTime,
            adapter.currentTime + (key === "l" ? 10 : 5),
          ),
        );
        ping();
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
  ]);

  return {
    hold2xUi,
    suppressNextClickRef,
    onSurfacePointerDown,
    onSurfacePointerUp,
    onSurfacePointerLeave,
  };
}
