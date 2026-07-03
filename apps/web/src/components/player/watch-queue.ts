"use client";

export type WatchQueueItem = { href: string; title: string };

const WATCH_QUEUE_STORAGE_KEY = "ot:watch-queue";

export function readWatchQueue(): WatchQueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WATCH_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is WatchQueueItem =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { href?: unknown }).href === "string" &&
          typeof (item as { title?: unknown }).title === "string",
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function writeWatchQueue(items: WatchQueueItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WATCH_QUEUE_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("ot:watch-queue-updated"));
  } catch {}
}
