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
  /** brandSoft flattened onto `background` — see `surfaceStrongSolid`. */
  brandSoftSolid: "hsl(347, 43%, 10%)",
  brandSofter: "hsla(350, 90%, 58%, 0.06)",
  secondary: "hsl(240, 4%, 12%)",
  destructive: "hsl(0, 91%, 71%)",
  success: "hsl(142, 71%, 45%)",
  border: "hsl(240, 3%, 14%)",
  /**
   * Focus is white, as in the Android TV YouTube app: an outline on cards and
   * fields, a white fill with dark text on buttons and list rows. Red stays
   * for the brand and for progress.
   */
  ring: "hsl(0, 0%, 100%)",
  focusFill: "hsl(0, 0%, 100%)",
  focusForeground: "hsl(240, 5%, 8%)",
  /** An unfocused card's title: a step down from white, which marks focus. */
  cardTitle: "hsl(0, 0%, 72%)",
  sidebar: "hsl(240, 5%, 5%)",
  surface: "hsla(0, 0%, 100%, 0.06)",
  surfaceStrong: "hsla(0, 0%, 100%, 0.1)",
  /**
   * surfaceStrong flattened onto `background`. A focused surface also casts the
   * red focus glow, and Android renders that glow *through* a translucent fill,
   * as a ragged frame inside the focus ring. So any fill that can end up under
   * the glow — a focused input, or a tint a caller passes to FocusButton, whose
   * `style` lands after the focused fill — has to be opaque.
   */
  surfaceStrongSolid: "hsl(240, 2%, 14%)",
  surfaceBorder: "hsla(0, 0%, 100%, 0.12)",
  shadow: "hsla(0, 0%, 0%, 0.45)",
  overlay: "hsla(0, 0%, 0%, 0.56)",
  heroScrimSoft: "rgba(0,0,0,0.14)",
  durationBadge: "rgba(0,0,0,0.82)",
  /** Unwatched remainder behind the watched-progress bar on thumbnails. */
  progressTrack: "rgba(0,0,0,0.4)",
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

/**
 * Sized in dp, matching the Android TV YouTube app. Measured off a 1080p
 * capture of its Subscriptions screen and halved: TV panels report 320dpi
 * (density 2), so a 1920x1080 screenshot is a 960x540 dp layout. Its video
 * titles are ~15dp, secondary metadata ~12dp, section headings ~13dp and page
 * titles ~20dp.
 */
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

/**
 * No zoom and no glow on focus, like the YouTube app: the white outline or
 * fill says it alone. Kept as tokens so focused styles still read them.
 */
export const focus = {
  borderWidth: 3,
  scale: 1,
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
} as const;
