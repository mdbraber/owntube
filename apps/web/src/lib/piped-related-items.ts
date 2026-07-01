/** Items from a Piped search/related payload (`items`, `results`, or `relatedStreams`). */
export function pipedRelatedListItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.relatedStreams) && o.relatedStreams.length > 0) {
    return o.relatedStreams;
  }
  if (Array.isArray(o.items)) return o.items;
  if (Array.isArray(o.results)) return o.results;
  return [];
}
