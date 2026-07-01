"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  THEME_STORAGE_KEY,
  type ThemeMode,
  type VisualTheme,
} from "@/lib/theme-appearance";

export type { ThemeMode, VisualTheme };

type ThemeState = {
  theme: ThemeMode;
  visualTheme: VisualTheme;
  setTheme: (theme: ThemeMode) => void;
  setVisualTheme: (visualTheme: VisualTheme) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "system",
      visualTheme: "default",
      setTheme: (theme) => set({ theme }),
      setVisualTheme: (visualTheme) => set({ visualTheme }),
    }),
    {
      name: THEME_STORAGE_KEY,
    },
  ),
);
