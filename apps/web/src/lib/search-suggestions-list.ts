/**
 * Merges local history and upstream suggestion strings for the topbar combobox.
 * History matches appear first (most recent), then upstream, de-duplicated.
 */
export function mergeSearchSuggestions(
  query: string,
  history: readonly string[],
  upstream: readonly string[],
  max: number = 10,
): string[] {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  for (const item of history) {
    push(item);
    if (out.length >= max) return out;
  }

  for (const item of upstream) {
    const key = item.trim().toLowerCase();
    if (needle && key === needle) continue;
    push(item);
    if (out.length >= max) return out;
  }

  return out;
}
