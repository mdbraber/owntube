"use client";

import { useEffect } from "react";
import { applyFaviconForTheme, faviconMatchesTheme } from "@/lib/favicon";
import { useThemeStore } from "@/stores/theme-store";

export function FaviconSync() {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const sync = () => {
      if (!faviconMatchesTheme(theme)) {
        applyFaviconForTheme(theme);
      }
    };

    const syncFromStore = () => {
      const currentTheme = useThemeStore.getState().theme;
      if (!faviconMatchesTheme(currentTheme)) {
        applyFaviconForTheme(currentTheme);
      }
    };

    sync();

    const unsubscribeHydration =
      useThemeStore.persist.onFinishHydration(syncFromStore);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sync);

    const observer = new MutationObserver(() => {
      syncFromStore();
    });
    observer.observe(document.head, { childList: true, subtree: true });

    return () => {
      unsubscribeHydration();
      media.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, [theme]);

  return null;
}
