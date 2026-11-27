/**
 * Library search syntax, as in Gmail and Fastmail search:
 *
 * - `in:` a place in OwnTube: favorites, subscriptions, saved, queue,
 *   history, or `playlist:"Name"` (case-insensitive name).
 * - `tag:` a channel tag, matched literally.
 * - `has:` a property of the video: `memo`.
 * - A space means AND, `OR` (uppercase) either, a leading `-` excludes,
 *   brackets group, and `OR` binds tighter than the space: `a b OR c` is
 *   `a AND (b OR c)`.
 * - Other words and "quoted phrases" match title, channel name and memo text.
 *
 * A query without any `in:`/`tag:`/`has:` filter is a plain YouTube search
 * and isn't parsed further (so a stray bracket in it is fine).
 *
 * Pure: shared by the server (library search) and the browser (errors and
 * suggestions under the search box).
 */
import { normalizeChannelTag } from "@/lib/channel-tag";

export const IN_PLACES = [
  "favorites",
  "subscriptions",
  "saved",
  "queue",
  "history",
] as const;
export type InPlace = (typeof IN_PLACES)[number];

export const HAS_PROPERTIES = ["memo"] as const;
export type HasProperty = (typeof HAS_PROPERTIES)[number];

export type LibraryFilter =
  /** `tag` is the favorite tag in effect (settings.favoriteTag). */
  | { kind: "in"; place: "favorites"; tag: string }
  | { kind: "in"; place: Exclude<InPlace, "favorites"> }
  | { kind: "in"; place: "playlist"; name: string }
  | { kind: "tag"; tag: string }
  | { kind: "has"; property: HasProperty };

export type QueryNode =
  | { type: "and"; children: QueryNode[] }
  | { type: "or"; children: QueryNode[] }
  | { type: "not"; child: QueryNode }
  | { type: "filter"; filter: LibraryFilter; ref: number }
  | { type: "text"; text: string };

/** A filter as it appears in the query, for chips. */
export type FilterRef = {
  filter: LibraryFilter;
  /** Under an odd number of `-`. */
  negated: boolean;
  /** The token as typed, without its leading `-`. */
  raw: string;
  /** Chip text: `in:favorites · #favorite`, `-tag:live`, … */
  label: string;
};

export type WordRef = { text: string; negated: boolean };

export type ParsedLibraryQuery =
  | { kind: "plain" }
  | { kind: "error"; message: string }
  | {
      kind: "library";
      tree: QueryNode;
      filters: FilterRef[];
      words: WordRef[];
    };

export type ParseOptions = { favoriteTag: string };

// ---------------------------------------------------------------- tokens

type Token =
  | { type: "lparen"; raw: "(" }
  | { type: "rparen"; raw: ")" }
  | { type: "or"; raw: "OR" }
  | { type: "not"; raw: "-" }
  | { type: "term"; raw: string };

const FILTER_KEY = /^(in|tag|has):/i;

function isSpace(ch: string): boolean {
  return /\s/.test(ch);
}

/** Split a query into tokens. Quoted segments stay whole, quotes included. */
export function tokenize(q: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i] as string;
    if (isSpace(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      out.push({ type: "lparen", raw: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ type: "rparen", raw: ")" });
      i++;
      continue;
    }
    const next = q[i + 1];
    if (ch === "-" && next !== undefined && !isSpace(next) && next !== ")") {
      out.push({ type: "not", raw: "-" });
      i++;
      continue;
    }
    let j = i;
    while (j < q.length) {
      const c = q[j] as string;
      if (isSpace(c) || c === "(" || c === ")") break;
      if (c === '"') {
        const close = q.indexOf('"', j + 1);
        j = close === -1 ? q.length : close + 1;
        continue;
      }
      j++;
    }
    const raw = q.slice(i, j);
    out.push(raw === "OR" ? { type: "or", raw: "OR" } : { type: "term", raw });
    i = j;
  }
  return out;
}

/** Tokens back to a query string, spaced the way people type them. */
export function untokenize(tokens: readonly Token[]): string {
  let s = "";
  let prev: Token | undefined;
  for (const t of tokens) {
    const glue =
      prev === undefined ||
      prev.type === "lparen" ||
      prev.type === "not" ||
      t.type === "rparen";
    s += (glue ? "" : " ") + t.raw;
    prev = t;
  }
  return s;
}

function unquote(raw: string): string {
  return raw.replace(/"/g, "");
}

function isFilterTerm(t: Token): boolean {
  return t.type === "term" && FILTER_KEY.test(t.raw);
}

/** Whether a query uses library filters (else it's a YouTube search). */
export function hasLibraryFilter(q: string): boolean {
  return tokenize(q).some(isFilterTerm);
}

// ---------------------------------------------------------------- filters

class QueryError extends Error {}

/** Quote a filter value when it needs it (spaces). */
export function quoteValue(value: string): string {
  return /[\s()]/.test(value) ? `"${value}"` : value;
}

function filterLabel(filter: LibraryFilter): string {
  switch (filter.kind) {
    case "has":
      return `has:${filter.property}`;
    case "tag":
      return `tag:${quoteValue(filter.tag)}`;
    case "in":
      if (filter.place === "favorites") {
        return `in:favorites · #${filter.tag}`;
      }
      if (filter.place === "playlist") {
        return `in:playlist:"${filter.name}"`;
      }
      return `in:${filter.place}`;
  }
}

const IN_HINT =
  'Try in:favorites, in:subscriptions, in:saved, in:queue, in:history or in:playlist:"Name".';

function parseFilter(raw: string, opts: ParseOptions): LibraryFilter {
  const colon = raw.indexOf(":");
  const key = raw.slice(0, colon).toLowerCase();
  const rawValue = raw.slice(colon + 1);
  const value = unquote(rawValue).trim();
  if (key === "has") {
    const prop = value.toLowerCase();
    if ((HAS_PROPERTIES as readonly string[]).includes(prop)) {
      return { kind: "has", property: prop as HasProperty };
    }
    throw new QueryError(
      value
        ? `Unknown filter has:${value}. Try has:memo.`
        : "has: needs a property: has:memo.",
    );
  }
  if (key === "tag") {
    const tag = normalizeChannelTag(value);
    if (!tag) throw new QueryError("tag: needs a tag, e.g. tag:music.");
    return { kind: "tag", tag };
  }
  // in:
  const lower = unquote(rawValue).toLowerCase();
  if (lower.startsWith("playlist:")) {
    const name = unquote(rawValue).slice("playlist:".length).trim();
    if (!name) {
      throw new QueryError(
        'in:playlist: needs a playlist name, e.g. in:playlist:"Road trip".',
      );
    }
    return { kind: "in", place: "playlist", name };
  }
  const place = value.toLowerCase();
  if (place === "favorites") {
    return { kind: "in", place: "favorites", tag: opts.favoriteTag };
  }
  if ((IN_PLACES as readonly string[]).includes(place)) {
    return { kind: "in", place: place as Exclude<InPlace, "favorites"> };
  }
  throw new QueryError(
    value
      ? `Unknown place in:${value}. ${IN_HINT}`
      : `in: needs a place. ${IN_HINT}`,
  );
}

// ---------------------------------------------------------------- parser

class Parser {
  private pos = 0;
  readonly filters: FilterRef[] = [];
  readonly words: WordRef[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly opts: ParseOptions,
  ) {}

  parse(): QueryNode {
    const node = this.sequence(0);
    const extra = this.tokens[this.pos];
    if (extra) {
      throw new QueryError(
        extra.type === "rparen"
          ? "A ) has no matching (."
          : `Unexpected ${extra.raw}.`,
      );
    }
    if (!node) throw new QueryError("Nothing to search for.");
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  /** Terms side by side (AND), up to a `)` or the end. */
  private sequence(negations: number): QueryNode | null {
    const items: QueryNode[] = [];
    for (;;) {
      const t = this.peek();
      if (!t || t.type === "rparen") break;
      items.push(this.either(negations));
    }
    if (items.length === 0) return null;
    return items.length === 1
      ? (items[0] as QueryNode)
      : { type: "and", children: items };
  }

  /** `a OR b OR c`. */
  private either(negations: number): QueryNode {
    const first = this.unary(negations);
    const options = [first];
    while (this.peek()?.type === "or") {
      this.pos++;
      const t = this.peek();
      if (!t || t.type === "rparen" || t.type === "or") {
        throw new QueryError("OR needs something on both sides.");
      }
      options.push(this.unary(negations));
    }
    return options.length === 1 ? first : { type: "or", children: options };
  }

  private unary(negations: number): QueryNode {
    const t = this.peek();
    if (t?.type === "not") {
      this.pos++;
      const next = this.peek();
      if (!next || next.type === "rparen" || next.type === "or") {
        throw new QueryError("A - needs something to exclude.");
      }
      return { type: "not", child: this.unary(negations + 1) };
    }
    return this.primary(negations);
  }

  private primary(negations: number): QueryNode {
    const t = this.peek();
    if (!t) throw new QueryError("The query ends too early.");
    if (t.type === "or") {
      throw new QueryError("OR needs something on both sides.");
    }
    if (t.type === "lparen") {
      this.pos++;
      const inner = this.sequence(negations);
      if (this.peek()?.type !== "rparen") {
        throw new QueryError("A ( has no matching ).");
      }
      this.pos++;
      if (!inner) throw new QueryError("Empty brackets ().");
      return inner;
    }
    if (t.type !== "term") throw new QueryError(`Unexpected ${t.raw}.`);
    this.pos++;
    const negated = negations % 2 === 1;
    if (FILTER_KEY.test(t.raw)) {
      const filter = parseFilter(t.raw, this.opts);
      const ref = this.filters.length;
      this.filters.push({
        filter,
        negated,
        raw: t.raw,
        label: `${negated ? "-" : ""}${filterLabel(filter)}`,
      });
      return { type: "filter", filter, ref };
    }
    const text = unquote(t.raw).trim();
    if (!text) throw new QueryError('Empty quotes "".');
    this.words.push({ text, negated });
    return { type: "text", text };
  }
}

/**
 * Parse a search query. `plain`: no filters, search YouTube with it as is.
 * `library`: a filter tree (words are leaves in it too) plus the filters and
 * words it uses. `error`: a message for under the search box.
 */
export function parseLibraryQuery(
  q: string,
  opts: ParseOptions,
): ParsedLibraryQuery {
  const tokens = tokenize(q);
  if (!tokens.some(isFilterTerm)) return { kind: "plain" };
  const quotes = (q.match(/"/g) ?? []).length;
  if (quotes % 2 === 1)
    return { kind: "error", message: 'A " has no closing quote.' };
  try {
    const parser = new Parser(tokens, opts);
    const tree = parser.parse();
    return {
      kind: "library",
      tree,
      filters: parser.filters,
      words: parser.words,
    };
  } catch (error) {
    if (error instanceof QueryError) {
      return { kind: "error", message: error.message };
    }
    throw error;
  }
}

/**
 * The query without its `index`-th filter (in typing order), tidied so it
 * still parses: a dangling OR, a lone `-` and empty brackets go too. For the
 * chips' remove buttons.
 */
export function removeFilterFromQuery(q: string, index: number): string {
  const tokens = tokenize(q);
  let seen = -1;
  const at = tokens.findIndex((t) => isFilterTerm(t) && ++seen === index);
  if (at === -1) return q;
  let start = at;
  while (start > 0 && tokens[start - 1]?.type === "not") start--;
  const rest = [...tokens.slice(0, start), ...tokens.slice(at + 1)];
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i] as Token;
      const prev = rest[i - 1];
      const next = rest[i + 1];
      const dangling =
        (t.type === "or" &&
          (!prev ||
            !next ||
            prev.type === "lparen" ||
            prev.type === "or" ||
            prev.type === "not" ||
            next.type === "rparen")) ||
        (t.type === "not" &&
          (!next || next.type === "rparen" || next.type === "or")) ||
        (t.type === "lparen" && next?.type === "rparen");
      if (dangling) {
        // Empty brackets go as a pair, with any - in front of them.
        let from = i;
        if (t.type === "lparen") {
          while (from > 0 && rest[from - 1]?.type === "not") from--;
        }
        rest.splice(from, i - from + (t.type === "lparen" ? 2 : 1));
        changed = true;
        break;
      }
    }
  }
  return untokenize(rest);
}

// ---------------------------------------------------------------- matching

/** Lowercase without diacritics, so "cafe" finds "Café". */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** What a video is known to be, as the evaluator needs it. */
export type LibraryVideoFacts = {
  /** Folded (see foldText) title, channel name and memo texts. */
  haystack: string;
  places: ReadonlySet<Exclude<InPlace, "favorites">>;
  /** Lowercased names of the playlists it is in. */
  playlistNames: ReadonlySet<string>;
  /** Its channel's tags. */
  channelTags: ReadonlySet<string>;
  hasMemo: boolean;
};

function filterMatches(f: LibraryFilter, v: LibraryVideoFacts): boolean {
  switch (f.kind) {
    case "has":
      return v.hasMemo;
    case "tag":
      return v.channelTags.has(f.tag);
    case "in":
      if (f.place === "favorites") return v.channelTags.has(f.tag);
      if (f.place === "playlist") {
        return v.playlistNames.has(f.name.toLowerCase());
      }
      return v.places.has(f.place);
  }
}

export function matchesLibraryQuery(
  node: QueryNode,
  v: LibraryVideoFacts,
): boolean {
  switch (node.type) {
    case "and":
      return node.children.every((c) => matchesLibraryQuery(c, v));
    case "or":
      return node.children.some((c) => matchesLibraryQuery(c, v));
    case "not":
      return !matchesLibraryQuery(node.child, v);
    case "filter":
      return filterMatches(node.filter, v);
    case "text":
      return v.haystack.includes(foldText(node.text));
  }
}
