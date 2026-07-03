"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// CSS pseudo-fullscreen: pins the player shell to the viewport. Used on iOS
// Safari, which exposes no element Fullscreen API and whose native
// `webkitEnterFullscreen` both replaces our custom controls with Apple's player
// and throws outright on MSE-backed (hls.js) video. Inline styles with
// `important` priority beat the shell's Tailwind utilities (aspect-video,
// rounded corners) and escape any parent `overflow: hidden`.
const PSEUDO_FULLSCREEN_STYLES: ReadonlyArray<[string, string]> = [
  ["position", "fixed"],
  ["top", "0"],
  ["right", "0"],
  ["bottom", "0"],
  ["left", "0"],
  ["width", "100vw"],
  ["max-width", "none"],
  ["max-height", "none"],
  ["margin", "0"],
  ["border-radius", "0"],
  ["z-index", "2147483646"],
  ["background", "#000"],
];

function applyPseudoFullscreen(el: HTMLElement, on: boolean) {
  if (on) {
    for (const [prop, value] of PSEUDO_FULLSCREEN_STYLES) {
      el.style.setProperty(prop, value, "important");
    }
    const dvhSupported = window.CSS?.supports?.("height", "100dvh") ?? false;
    el.style.setProperty(
      "height",
      dvhSupported ? "100dvh" : "100vh",
      "important",
    );
    document.documentElement.style.setProperty("overflow", "hidden");
  } else {
    for (const [prop] of PSEUDO_FULLSCREEN_STYLES) {
      el.style.removeProperty(prop);
    }
    el.style.removeProperty("height");
    document.documentElement.style.removeProperty("overflow");
  }
}

export function useFullscreenShell(
  shellRef: React.RefObject<HTMLElement | null>,
) {
  const [active, setActive] = useState(false);
  const pseudoActiveRef = useRef(false);
  useEffect(() => {
    const onChange = () => {
      const video = shellRef.current?.querySelector("video") as
        | (HTMLVideoElement & {
            webkitDisplayingFullscreen?: boolean;
          })
        | null;
      const standardActive = document.fullscreenElement === shellRef.current;
      const webkitActive = Boolean(video?.webkitDisplayingFullscreen);
      setActive(standardActive || webkitActive || pseudoActiveRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    const video = shellRef.current?.querySelector("video");
    video?.addEventListener("webkitbeginfullscreen", onChange as EventListener);
    video?.addEventListener("webkitendfullscreen", onChange as EventListener);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      video?.removeEventListener(
        "webkitbeginfullscreen",
        onChange as EventListener,
      );
      video?.removeEventListener(
        "webkitendfullscreen",
        onChange as EventListener,
      );
    };
  }, [shellRef]);
  // Drop the pinned viewport styles if the shell unmounts while pseudo-active.
  useEffect(() => {
    return () => {
      if (pseudoActiveRef.current) {
        document.documentElement.style.removeProperty("overflow");
      }
    };
  }, []);
  const setPseudo = useCallback(
    (on: boolean) => {
      const el = shellRef.current;
      if (!el) return;
      pseudoActiveRef.current = on;
      applyPseudoFullscreen(el, on);
      setActive(on || document.fullscreenElement === el);
    },
    [shellRef],
  );
  const toggle = useCallback(async () => {
    const el = shellRef.current;
    if (!el) return;
    const video = el.querySelector("video") as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitExitFullscreen?: () => void;
          webkitDisplayingFullscreen?: boolean;
        })
      | null;
    const doc = document as Document & {
      webkitExitFullscreen?: () => void;
    };
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (pseudoActiveRef.current) {
        setPseudo(false);
        return;
      }
      if (video?.webkitDisplayingFullscreen) {
        if (typeof video.webkitExitFullscreen === "function") {
          video.webkitExitFullscreen();
          return;
        }
        if (typeof doc.webkitExitFullscreen === "function") {
          doc.webkitExitFullscreen();
          return;
        }
      }
      if (typeof el.requestFullscreen === "function") {
        await el.requestFullscreen();
        return;
      }
      // iOS Safari: no element Fullscreen API. Pin the shell to the viewport so
      // the custom controls stay usable instead of handing off to Apple's player.
      setPseudo(true);
    } catch {
      // Standard request failed/denied — fall back to CSS pseudo-fullscreen.
      setPseudo(true);
    }
  }, [shellRef, setPseudo]);
  return { active, toggle };
}

export function useIdleVisible(paused: boolean, settingsOpen: boolean) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const ping = useCallback(() => {
    setVisible(true);
    clear();
    if (paused || settingsOpen) return;
    timer.current = window.setTimeout(() => setVisible(false), 2500);
  }, [paused, settingsOpen, clear]);

  useEffect(() => {
    ping();
    return clear;
  }, [ping, clear]);

  useEffect(() => {
    if (paused || settingsOpen) {
      setVisible(true);
      clear();
    }
  }, [paused, settingsOpen, clear]);

  return { visible, ping, hide: () => setVisible(false) };
}
