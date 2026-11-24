/**
 * Desktop sidebar configuration shared by the server settings schema and the
 * client (sidebar + settings editor). Kept free of React so `profile.ts` can
 * import it.
 *
 * The setting is the ordered list of sidebar entries, each shown or hidden,
 * plus whether the Following list is collapsed. Besides the nav destinations
 * there are two special entries: `divider` (a separator line) and `following`
 * (the subscribed-channels list).
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

/**
 * The stored entries as a complete list: unknown and duplicate keys dropped,
 * and any entry the stored list lacks (one added in a later release) shown,
 * right after the entry that precedes it in the built-in order.
 */
export function resolveSidebarEntries(
  stored: readonly SidebarNavEntry[] | undefined,
): SidebarNavEntry[] {
  const out: SidebarNavEntry[] = [];
  const seen = new Set<string>();
  for (const entry of stored ?? []) {
    if (KNOWN.has(entry.key) && !seen.has(entry.key)) {
      seen.add(entry.key);
      out.push({ key: entry.key, hidden: entry.hidden });
    }
  }
  SIDEBAR_NAV_KEYS.forEach((key, i) => {
    if (seen.has(key)) return;
    seen.add(key);
    const before = i > 0 ? SIDEBAR_NAV_KEYS[i - 1] : undefined;
    const at = before ? out.findIndex((e) => e.key === before) + 1 : 0;
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
 * row, and always around the Following list (its own section).
 */
export function sidebarSlots(
  entries: readonly SidebarNavEntry[],
  { signedIn }: { signedIn: boolean },
): SidebarSlot[] {
  const raw: SidebarSlot[] = [];
  for (const { key, hidden } of entries) {
    if (hidden) continue;
    if (key === SIDEBAR_DIVIDER) raw.push({ kind: "divider" });
    else if (key === SIDEBAR_FOLLOWING) {
      if (!signedIn) continue;
      raw.push({ kind: "divider" }, { kind: "following" }, { kind: "divider" });
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
