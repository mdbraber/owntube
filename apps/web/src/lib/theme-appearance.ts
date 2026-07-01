export type ThemeMode = "system" | "light" | "dark";
export type VisualTheme = "default" | "terminal";

export const THEME_STORAGE_KEY = "owntube-theme";

export function resolveIsDarkTheme(theme: ThemeMode): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
