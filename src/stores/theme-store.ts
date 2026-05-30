"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_STORAGE_KEY, type ThemeMode } from "@/lib/theme-appearance";

export type { ThemeMode };

type ThemeState = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: THEME_STORAGE_KEY,
    },
  ),
);
