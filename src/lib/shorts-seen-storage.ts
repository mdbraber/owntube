const STORAGE_KEY = "owntube:shortsSeen";

/** Cap stored ids so the list cannot grow unbounded in localStorage. */
export const MAX_STORED_SEEN_SHORTS = 3000;

/**
 * Appends newly seen short ids to the existing list (most recent kept last),
 * de-duplicated and capped to `max`. Pure helper so it can be unit-tested
 * without a DOM.
 */
export function mergeSeenShortIds(
  existing: readonly string[],
  incoming: readonly string[],
  max: number = MAX_STORED_SEEN_SHORTS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...existing, ...incoming]) {
    const trimmed = id.trim();
    if (trimmed.length < 5 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.length > max ? out.slice(out.length - max) : out;
}

export function readSeenShortIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Adds ids to the persisted seen list and returns the updated list. */
export function recordSeenShortIds(ids: readonly string[]): string[] {
  if (typeof window === "undefined") return [];
  const merged = mergeSeenShortIds(readSeenShortIds(), ids);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* quota / private mode */
  }
  return merged;
}
