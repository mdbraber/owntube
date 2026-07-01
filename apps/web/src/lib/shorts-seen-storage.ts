const STORAGE_KEY = "owntube:shortsSeen";

/** Cap stored entries so the list cannot grow unbounded in localStorage. */
export const MAX_STORED_SEEN_SHORTS = 3000;

/**
 * Entries older than this are pruned on read so shorts can resurface, matching
 * the server-side seen window (`SHORTS_SEEN_HARD_WINDOW_SEC`).
 */
export const SEEN_SHORTS_TTL_MS = 45 * 24 * 3600 * 1000;

type SeenShortEntry = { id: string; seenAt: number };

function isValidEntry(value: unknown): value is SeenShortEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SeenShortEntry).id === "string" &&
    typeof (value as SeenShortEntry).seenAt === "number"
  );
}

/**
 * Parses the stored payload. Legacy format was a plain string array without
 * timestamps; those entries are treated as freshly seen so they stay excluded
 * for one full window, then age out.
 */
function parseStoredEntries(raw: string, nowMs: number): SeenShortEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  const entries: SeenShortEntry[] = [];
  for (const item of parsed) {
    if (typeof item === "string") {
      entries.push({ id: item, seenAt: nowMs });
    } else if (isValidEntry(item)) {
      entries.push(item);
    }
  }
  return entries;
}

/**
 * Appends newly seen entries to the existing list (most recent kept last),
 * de-duplicated (a re-seen id gets the fresher timestamp), pruned by TTL and
 * capped to `max`. Pure helper so it can be unit-tested without a DOM.
 */
export function mergeSeenShortEntries(
  existing: readonly SeenShortEntry[],
  incomingIds: readonly string[],
  nowMs: number,
  max: number = MAX_STORED_SEEN_SHORTS,
): SeenShortEntry[] {
  const byId = new Map<string, number>();
  for (const entry of existing) {
    const trimmed = entry.id.trim();
    if (trimmed.length < 5) continue;
    if (nowMs - entry.seenAt > SEEN_SHORTS_TTL_MS) continue;
    byId.set(trimmed, Math.max(byId.get(trimmed) ?? 0, entry.seenAt));
  }
  for (const id of incomingIds) {
    const trimmed = id.trim();
    if (trimmed.length < 5) continue;
    byId.set(trimmed, nowMs);
  }
  const out = [...byId.entries()].map(([id, seenAt]) => ({ id, seenAt }));
  return out.length > max ? out.slice(out.length - max) : out;
}

export function readSeenShortIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const nowMs = Date.now();
    return parseStoredEntries(raw, nowMs)
      .filter((entry) => nowMs - entry.seenAt <= SEEN_SHORTS_TTL_MS)
      .map((entry) => entry.id);
  } catch {
    return [];
  }
}

/** Adds ids to the persisted seen list and returns the updated id list. */
export function recordSeenShortIds(ids: readonly string[]): string[] {
  if (typeof window === "undefined") return [];
  const nowMs = Date.now();
  let existing: SeenShortEntry[] = [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) existing = parseStoredEntries(raw, nowMs);
  } catch {
    existing = [];
  }
  const merged = mergeSeenShortEntries(existing, ids, nowMs);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* quota / private mode */
  }
  return merged.map((entry) => entry.id);
}
