import * as SecureStore from "expo-secure-store";
import type { Section } from "@/components/Sidebar";

/**
 * Which sidebar sections show, and in what order. Device-local rather than a
 * server setting: the web app has no sidebar to share prefs with, and the
 * useful arrangement differs per TV. Stored alongside the auth token in
 * expo-secure-store — the payload is far under the platform's ~2KB limit.
 */
const KEY = "owntube.sidebar-prefs";

/**
 * Every section the shell can render, in shipped order: the Android TV
 * YouTube app's rail (Search, Home, Shorts, Subscriptions, Library), then
 * OwnTube's own, Settings last.
 */
export const ALL_SECTIONS: Section[] = [
  "search",
  "home",
  "shorts",
  "subscriptions",
  "favorites",
  "library",
  "recommended",
  "trending",
  "queue",
  "saved",
  "playlists",
  "history",
  "settings",
];

/**
 * The sections Library gathers up. Off the rail by default, as on the
 * YouTube TV client, but still there in the sidebar editor for anyone who
 * wants one back as a top-level entry.
 */
export const LIBRARY_SECTIONS: Section[] = [
  "queue",
  "saved",
  "playlists",
  "history",
];

export type SidebarPrefs = {
  /** Ordered; sections absent from this list are hidden. */
  order: Section[];
};

export const DEFAULT_PREFS: SidebarPrefs = {
  order: ALL_SECTIONS.filter((s) => !LIBRARY_SECTIONS.includes(s)),
};

/**
 * Every section the stored prefs have been offered. A section added since
 * (Saved and Trending, for one) is shown once, before Settings, rather than
 * being taken for one the user hid; after that, hiding it sticks.
 */
function withNewSections(order: Section[], known: unknown): Section[] {
  const knownSet = new Set(
    Array.isArray(known) ? known.filter((k) => typeof k === "string") : [],
  );
  // Prefs saved before `known` existed had seen exactly these.
  if (!Array.isArray(known)) {
    for (const s of LEGACY_SECTIONS) knownSet.add(s);
  }
  const added = ALL_SECTIONS.filter(
    (s) => !knownSet.has(s) && !order.includes(s),
  );
  if (added.length === 0) return order;
  // Library's arrival folds the sections it gathers: it takes the place of
  // the first of them on the rail and the rest come off. The editor still
  // lists them, so a hidden one is a single toggle away.
  let rest = added;
  if (added.includes("library")) {
    const first = order.findIndex((s) => LIBRARY_SECTIONS.includes(s));
    const kept = order.filter((s) => !LIBRARY_SECTIONS.includes(s));
    const at = first >= 0 ? Math.min(first, kept.length) : kept.length;
    order = [...kept.slice(0, at), "library", ...kept.slice(at)];
    // A gathered section this install never saw (Saved, for older prefs)
    // arrives folded too, not as a new rail entry.
    rest = added.filter(
      (s) => s !== "library" && !LIBRARY_SECTIONS.includes(s),
    );
  }
  // Each arrival goes where it ships: after the nearest section before it in
  // ALL_SECTIONS that the rail shows (Favorites after Subscriptions), or
  // before Settings when none of those is shown.
  let next = [...order];
  for (const section of rest) {
    const shipped = ALL_SECTIONS.indexOf(section);
    let at = -1;
    for (let i = shipped - 1; i >= 0 && at < 0; i--) {
      const shown = next.indexOf(ALL_SECTIONS[i]);
      if (shown >= 0) at = shown + 1;
    }
    if (at < 0) {
      const settings = next.indexOf("settings");
      at = settings >= 0 ? settings : next.length;
    }
    next = [...next.slice(0, at), section, ...next.slice(at)];
  }
  return next;
}

/** The sections that existed before `known` was stored. */
const LEGACY_SECTIONS: Section[] = [
  "home",
  "search",
  "queue",
  "subscriptions",
  "recommended",
  "playlists",
  "history",
  "settings",
];

/** Drops unknown sections so a removed feature can't strand the sidebar. */
function sanitize(order: unknown): SidebarPrefs {
  if (!Array.isArray(order)) return DEFAULT_PREFS;
  const seen = new Set<string>();
  const cleaned: Section[] = [];
  for (const value of order) {
    if (typeof value !== "string") continue;
    if (!(ALL_SECTIONS as string[]).includes(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    cleaned.push(value as Section);
  }
  // Settings must stay reachable, or the prefs can't be repaired on-device.
  if (!cleaned.includes("settings")) cleaned.push("settings");
  return { order: cleaned };
}

export async function loadSidebarPrefs(): Promise<SidebarPrefs> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return DEFAULT_PREFS;
    const stored = JSON.parse(raw);
    const prefs = sanitize(stored?.order);
    return { order: withNewSections(prefs.order, stored?.known) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function saveSidebarPrefs(prefs: SidebarPrefs): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      KEY,
      JSON.stringify({ ...sanitize(prefs.order), known: ALL_SECTIONS }),
    );
  } catch {
    // Prefs are a convenience; a storage failure shouldn't surface as an error.
  }
}
