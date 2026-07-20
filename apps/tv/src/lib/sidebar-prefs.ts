import * as SecureStore from "expo-secure-store";
import type { Section } from "@/components/Sidebar";

/**
 * Which sidebar sections show, and in what order. Device-local rather than a
 * server setting: the web app has no sidebar to share prefs with, and the
 * useful arrangement differs per TV. Stored alongside the auth token in
 * expo-secure-store — the payload is far under the platform's ~2KB limit.
 */
const KEY = "owntube.sidebar-prefs";

/** Every section the shell can render, in shipped order. */
export const ALL_SECTIONS: Section[] = [
  "home",
  "search",
  "queue",
  "subscriptions",
  "recommended",
  "playlists",
  "history",
  "settings",
];

export type SidebarPrefs = {
  /** Ordered; sections absent from this list are hidden. */
  order: Section[];
};

export const DEFAULT_PREFS: SidebarPrefs = { order: ALL_SECTIONS };

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
    return sanitize(JSON.parse(raw)?.order);
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function saveSidebarPrefs(prefs: SidebarPrefs): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(sanitize(prefs.order)));
  } catch {
    // Prefs are a convenience; a storage failure shouldn't surface as an error.
  }
}
