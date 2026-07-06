/** Max length of a stored channel tag (after normalization). */
export const CHANNEL_TAG_MAX_LEN = 32;

/**
 * Normalize a user-entered channel tag: strip a leading `#`, trim, lowercase,
 * collapse inner whitespace to single spaces, and drop characters other than
 * letters, numbers, space, `-` and `_`. Returns null when nothing usable
 * remains (so callers can reject empty tags).
 */
export function normalizeChannelTag(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHANNEL_TAG_MAX_LEN)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
