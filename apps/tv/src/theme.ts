/**
 * owntube design tokens ported from the web dark SaaS theme. The TV client stays
 * dark-only and uses platform fonts; monospace is reserved for technical data.
 */
export const colors = {
  background: "hsl(240, 5%, 4%)",
  foreground: "hsl(0, 0%, 96%)",
  videoBackground: "hsl(0, 0%, 0%)",
  card: "hsl(240, 4%, 7%)",
  cardElevated: "hsl(240, 4%, 9%)",
  cardForeground: "hsl(0, 0%, 96%)",
  muted: "hsl(240, 4%, 12%)",
  mutedForeground: "hsl(0, 0%, 64%)",
  accent: "hsl(240, 4%, 12%)",
  accentForeground: "hsl(0, 0%, 96%)",
  brand: "hsl(350, 90%, 58%)",
  primary: "hsl(350, 90%, 58%)",
  primaryForeground: "hsl(0, 0%, 100%)",
  brandSoft: "hsla(350, 90%, 58%, 0.12)",
  brandSofter: "hsla(350, 90%, 58%, 0.06)",
  secondary: "hsl(240, 4%, 12%)",
  destructive: "hsl(0, 91%, 71%)",
  success: "hsl(142, 71%, 45%)",
  border: "hsl(240, 3%, 14%)",
  ring: "hsl(350, 90%, 58%)",
  sidebar: "hsl(240, 5%, 5%)",
  surface: "hsla(0, 0%, 100%, 0.06)",
  surfaceStrong: "hsla(0, 0%, 100%, 0.1)",
  surfaceBorder: "hsla(0, 0%, 100%, 0.12)",
  shadow: "hsla(0, 0%, 0%, 0.45)",
  overlay: "hsla(0, 0%, 0%, 0.56)",
  heroScrimSoft: "rgba(0,0,0,0.14)",
  durationBadge: "rgba(0,0,0,0.82)",
  avatarFallback: "hsl(240, 4%, 12%)",
} as const;

/** rem→px against the charte's 16px base. shell = controls, card = thumbnails. */
export const radius = {
  shell: 10, // --radius-shell 0.625rem
  card: 14, // --radius-card 0.875rem
  hero: 20,
} as const;

export const spacing = {
  xs: 8,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  // 10-foot UIs need generous outer margins; TVs overscan the edges.
  screen: 36,
} as const;

export const fontSize = {
  sm: 13,
  base: 15,
  md: 16,
  lg: 19,
  xl: 24,
  xxl: 28,
  brand: 20,
} as const;

/** Monospace only for technical data (durations, ids, urls) — never titles/nav. */
export const monoFont = "monospace";

export const focus = {
  borderWidth: 3,
  scale: 1.015,
  shadowOpacity: 0.34,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 12,
} as const;
