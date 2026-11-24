/**
 * Desktop sidebar configuration shared by the server settings schema and the
 * client (sidebar + settings editor). Kept free of React so `profile.ts` can
 * import it.
 *
 * The setting is the ordered list of sidebar entries, each shown or hidden,
 * plus whether the Following list is collapsed. Besides the nav destinations
 * there are separators (`divider`, `divider:<n>`; as many as the user adds)
 * and `following` (the subscribed-channels list).
 */

export const SIDEBAR_DIVIDER = "divider";
export const SIDEBAR_FOLLOWING = "following";

/** Every sidebar entry, in the built-in order (the sidebar before it was configurable). */
export const SIDEBAR_NAV_KEYS = [
  "home",
  "recommended",
  "shorts",
  "explore",
  SIDEBAR_DIVIDER,
  "library",
  "subs",
  "favorites",
  "playlists",
  "queue",
  "saved",
  "divider:2",
  SIDEBAR_FOLLOWING,
] as const;

export type SidebarNavEntry = { key: string; hidden: boolean };

export type SidebarNavSetting = {
  items: SidebarNavEntry[];
  followingCollapsed: boolean;
};

export const DEFAULT_SIDEBAR_NAV: SidebarNavSetting = {
  items: SIDEBAR_NAV_KEYS.map((key) => ({ key, hidden: false })),
  followingCollapsed: false,
};

const KNOWN = new Set<string>(SIDEBAR_NAV_KEYS);

/** Most separators a sidebar may have. */
export const MAX_SIDEBAR_DIVIDERS = 8;

/**
 * Separators can repeat, so each has its own key: the built-in one is
 * `divider`, added ones `divider:<suffix>`.
 */
export function isDividerKey(key: string): boolean {
  return key === SIDEBAR_DIVIDER || /^divider:[a-z0-9]{1,16}$/.test(key);
}

/** A key for a new separator, unique among `entries`. */
export function newDividerKey(entries: readonly SidebarNavEntry[]): string {
  const taken = new Set(entries.map((e) => e.key));
  for (let n = 1; ; n++) {
    const key = `divider:${n}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * The stored entries as a complete list: unknown and duplicate keys dropped,
 * and any nav entry the stored list lacks (one added in a later release)
 * shown, right after the entry that precedes it in the built-in order.
 * Separators are the user's own: the ones stored, never re-added once
 * removed (the built-in one only when nothing is stored at all).
 */
export function resolveSidebarEntries(
  stored: readonly SidebarNavEntry[] | undefined,
): SidebarNavEntry[] {
  if (!stored || stored.length === 0) return DEFAULT_SIDEBAR_NAV.items;
  const out: SidebarNavEntry[] = [];
  const seen = new Set<string>();
  let dividers = 0;
  for (const entry of stored) {
    if (seen.has(entry.key)) continue;
    if (isDividerKey(entry.key)) {
      // A separator switched off (before they could be removed) is a removed one.
      if (entry.hidden || dividers >= MAX_SIDEBAR_DIVIDERS) continue;
      dividers++;
    } else if (!KNOWN.has(entry.key)) continue;
    seen.add(entry.key);
    out.push({ key: entry.key, hidden: entry.hidden });
  }
  SIDEBAR_NAV_KEYS.forEach((key, i) => {
    if (seen.has(key) || isDividerKey(key)) return;
    seen.add(key);
    // After the nearest built-in predecessor still in the list (else first).
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const found = out.findIndex((e) => e.key === SIDEBAR_NAV_KEYS[j]);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    out.splice(at, 0, { key, hidden: false });
  });
  return out;
}

export type SidebarSlot =
  | { kind: "link"; key: string }
  | { kind: "divider" }
  | { kind: "following" };

/**
 * What the sidebar renders, top to bottom: hidden entries dropped, Following
 * only when signed in, and separators tidied: never first, last or twice in a
 * row.
 */
export function sidebarSlots(
  entries: readonly SidebarNavEntry[],
  { signedIn }: { signedIn: boolean },
): SidebarSlot[] {
  const raw: SidebarSlot[] = [];
  for (const { key, hidden } of entries) {
    if (hidden) continue;
    if (isDividerKey(key)) raw.push({ kind: "divider" });
    else if (key === SIDEBAR_FOLLOWING) {
      if (signedIn) raw.push({ kind: "following" });
    } else raw.push({ kind: "link", key });
  }
  const out: SidebarSlot[] = [];
  for (const slot of raw) {
    if (slot.kind === "divider") {
      const prev = out[out.length - 1];
      if (!prev || prev.kind === "divider") continue;
    }
    out.push(slot);
  }
  while (out[out.length - 1]?.kind === "divider") out.pop();
  return out;
}
