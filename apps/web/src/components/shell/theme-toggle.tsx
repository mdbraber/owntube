"use client";

import { useCallback } from "react";
import { type ThemeMode, useThemeStore } from "@/stores/theme-store";

const ORDER: ThemeMode[] = ["system", "light", "dark"];

function nextMode(current: ThemeMode): ThemeMode {
  const i = ORDER.indexOf(current);
  return ORDER[(i + 1) % ORDER.length] ?? "system";
}

function label(mode: ThemeMode): string {
  if (mode === "system") return "Theme: system";
  if (mode === "light") return "Theme: light";
  return "Theme: dark";
}

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const cycle = useCallback(() => {
    setTheme(nextMode(theme));
  }, [setTheme, theme]);

  return (
    <button
      type="button"
      className="ot-theme-toggle inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-shell)] text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      onClick={cycle}
      aria-label={label(theme)}
      title={label(theme)}
    >
      {theme === "light" ? (
        <SunIcon />
      ) : theme === "dark" ? (
        <MoonIcon />
      ) : (
        <SystemIcon />
      )}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <title>Sun</title>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <title>Moon</title>
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <title>System theme</title>
      <rect
        x="2"
        y="3"
        width="20"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
