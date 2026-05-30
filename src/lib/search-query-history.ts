const STORAGE_KEY = "owntube:searchQueries";

export const MAX_SEARCH_QUERY_HISTORY = 20;

/**
 * Returns recent queries matching `prefix` (case-insensitive start), most recent first.
 * When `prefix` is empty, returns the full history (most recent first).
 */
export function filterSearchQueryHistory(
  queries: readonly string[],
  prefix: string,
  max: number = MAX_SEARCH_QUERY_HISTORY,
): string[] {
  const needle = prefix.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = queries.length - 1; i >= 0; i -= 1) {
    const raw = queries[i];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    if (needle && !key.startsWith(needle)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

export function readSearchQueryHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === "string");
  } catch {
    return [];
  }
}

/** Persists a submitted query; returns the updated list (oldest dropped at cap). */
export function recordSearchQuery(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed || typeof window === "undefined") {
    return readSearchQueryHistory();
  }
  const existing = readSearchQueryHistory();
  const without = existing.filter(
    (q) => q.trim().toLowerCase() !== trimmed.toLowerCase(),
  );
  const merged = [...without, trimmed];
  const capped =
    merged.length > MAX_SEARCH_QUERY_HISTORY
      ? merged.slice(merged.length - MAX_SEARCH_QUERY_HISTORY)
      : merged;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    /* quota / private mode */
  }
  return capped;
}
