/**
 * Bottom tab-bar configuration shared by the server settings schema and the
 * client (renderer + editor). Kept free of React so `profile.ts` can import it.
 *
 * The setting is an ordered list of nav keys shown as tabs in the mobile bottom
 * bar; every assignable destination NOT in this list is reachable under the
 * Account (profile) button instead. Min 1, max 5 tabs (the profile button is
 * always the last cell, on top of these).
 */
export const MIN_BOTTOM_NAV = 1;
export const MAX_BOTTOM_NAV = 5;

/** Default tabs — the previous hard-coded bar. */
export const DEFAULT_BOTTOM_NAV_KEYS = [
  "home",
  "subs",
  "recommended",
  "saved",
] as const;

/** Clamp/sanitize an arbitrary key list to a valid bar (dedupe, drop empties, cap). */
export function sanitizeBottomNav(
  keys: readonly string[] | undefined,
  fallback: readonly string[] = DEFAULT_BOTTOM_NAV_KEYS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys ?? []) {
    const key = k.trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
      if (out.length >= MAX_BOTTOM_NAV) break;
    }
  }
  return out.length >= MIN_BOTTOM_NAV ? out : [...fallback];
}
