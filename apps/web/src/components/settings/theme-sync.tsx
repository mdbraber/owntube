"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/stores/theme-store";

export function ThemeSync() {
  const theme = useThemeStore((s) => s.theme);
  const visualTheme = useThemeStore((s) => s.visualTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (theme === "light") root.classList.add("light");
    if (theme === "dark") root.classList.add("dark");
    if (visualTheme === "terminal") {
      root.dataset.visualTheme = "terminal";
    } else {
      delete root.dataset.visualTheme;
    }
  }, [theme, visualTheme]);

  return null;
}
