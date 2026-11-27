import { HAS_PROPERTIES, IN_PLACES, quoteValue } from "@/lib/library-query";

export type LibraryVocabulary = {
  favoriteTag: string;
  tags: readonly { tag: string; count: number }[];
  playlists: readonly { name: string }[];
};

export type FilterSuggestion = {
  /** The whole query after choosing this suggestion. */
  value: string;
  /** What the row shows, e.g. `in:favorites · #favorite`. */
  label: string;
  hint?: string;
};

const FILTER_AT_CURSOR = /^([-(]*)(has|tag|in):(.*)$/i;

/** Where the token being typed at the end of `q` starts (quotes kept whole). */
function currentTokenStart(q: string): number {
  let start = 0;
  let quoted = false;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i] as string;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (/\s/.test(ch) || ch === ")")) start = i + 1;
  }
  return start;
}

const PLACE_HINTS: Record<(typeof IN_PLACES)[number], string> = {
  favorites: "channels with your favorite tag",
  subscriptions: "channels you follow",
  saved: "saved videos",
  queue: "your queue",
  history: "watched videos",
};

type Candidate = { insert: string; label?: string; hint?: string };

function candidatesFor(
  key: string,
  partial: string,
  vocab: LibraryVocabulary | null,
): Candidate[] {
  if (key === "has") {
    return HAS_PROPERTIES.filter((p) => p.startsWith(partial)).map((p) => ({
      insert: `has:${p}`,
      hint: "videos with a memo",
    }));
  }
  if (key === "tag") {
    return (vocab?.tags ?? [])
      .filter((t) => t.tag.includes(partial))
      .map((t) => ({
        insert: `tag:${quoteValue(t.tag)}`,
        hint: `${t.count} channel${t.count === 1 ? "" : "s"}`,
      }));
  }
  // in:
  if (partial.startsWith("playlist:")) {
    const name = partial.slice("playlist:".length);
    return (vocab?.playlists ?? [])
      .filter((p) => p.name.toLowerCase().includes(name))
      .map((p) => ({ insert: `in:playlist:"${p.name}"`, hint: "playlist" }));
  }
  const favoriteTag = vocab?.favoriteTag ?? "favorite";
  const places: Candidate[] = IN_PLACES.filter((p) =>
    p.startsWith(partial),
  ).map((p) =>
    p === "favorites"
      ? {
          insert: "in:favorites",
          label: `in:favorites · #${favoriteTag}`,
          hint: PLACE_HINTS.favorites,
        }
      : { insert: `in:${p}`, hint: PLACE_HINTS[p] },
  );
  if ("playlist:".startsWith(partial)) {
    places.push({ insert: "in:playlist:", hint: "a playlist by name" });
    for (const p of vocab?.playlists ?? []) {
      places.push({ insert: `in:playlist:"${p.name}"`, hint: "playlist" });
    }
  }
  return places;
}

/**
 * Values for the filter being typed at the end of the query (`has:`, `tag:`,
 * `in:`), each as the full query it completes to. Empty when the end of the
 * query isn't a filter.
 */
export function libraryFilterSuggestions(
  q: string,
  vocab: LibraryVocabulary | null,
  limit = 10,
): FilterSuggestion[] {
  const start = currentTokenStart(q);
  const match = FILTER_AT_CURSOR.exec(q.slice(start));
  if (!match) return [];
  const [, prefix = "", rawKey = "", rest = ""] = match;
  const key = rawKey.toLowerCase();
  const partial = rest.replace(/"/g, "").toLowerCase();
  const head = q.slice(0, start) + prefix;
  return candidatesFor(key, partial, vocab)
    .filter((c) => c.insert.toLowerCase() !== `${key}:${rest}`.toLowerCase())
    .slice(0, limit)
    .map((c) => ({
      value: head + c.insert + (c.insert.endsWith(":") ? "" : " "),
      label: prefix + (c.label ?? c.insert),
      hint: c.hint,
    }));
}
