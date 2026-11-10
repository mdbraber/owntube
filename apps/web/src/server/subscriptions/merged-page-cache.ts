import { createHash } from "node:crypto";

/**
 * A short-lived memo for merged subscription-feed pages.
 *
 * Building a page walks every subscribed channel's buffer from rank 0 (see
 * collectSortedFeedPage), so page N costs about N times page 1, and the TV
 * asks for the same pages often: one shelf per tag, Home's subscriptions row
 * paging on, the Subscriptions screen, and each again on return. The result
 * depends only on the channel set and the page window, not on who asks, so
 * the same key serves every caller for a minute. The promise is stored, so
 * concurrent identical requests share one walk; a failure isn't kept.
 */
const TTL_MS = 60_000;
const MAX_ENTRIES = 200;

type Entry<T> = { at: number; value: Promise<T> };
const entries = new Map<string, Entry<unknown>>();

export function mergedPageKey(
  channelIds: readonly string[],
  offset: number,
  limit: number,
): string {
  const channels = createHash("sha1")
    .update(channelIds.join(","))
    .digest("hex");
  return `${channels}:${offset}:${limit}`;
}

export function memoMergedPage<T>(
  key: string,
  build: () => Promise<T>,
  now: number = Date.now(),
): Promise<T> {
  const hit = entries.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = build();
  entries.delete(key);
  entries.set(key, { at: now, value });
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  // Map keeps insertion order: the first keys are the oldest.
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return value;
}

/** Tests only: start from an empty memo. */
export function resetMergedPageMemo(): void {
  entries.clear();
}
