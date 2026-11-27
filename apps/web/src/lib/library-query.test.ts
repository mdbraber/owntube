import { describe, expect, it } from "vitest";
import {
  foldText,
  hasLibraryFilter,
  type LibraryVideoFacts,
  matchesLibraryQuery,
  type ParsedLibraryQuery,
  parseLibraryQuery,
  type QueryNode,
  removeFilterFromQuery,
} from "@/lib/library-query";

const opts = { favoriteTag: "favorite" };

function tree(q: string, o = opts): QueryNode {
  const parsed = parseLibraryQuery(q, o);
  if (parsed.kind !== "library") {
    throw new Error(`expected a library query, got ${JSON.stringify(parsed)}`);
  }
  return parsed.tree;
}

function library(q: string, o = opts) {
  const parsed = parseLibraryQuery(q, o);
  if (parsed.kind !== "library") throw new Error(JSON.stringify(parsed));
  return parsed;
}

function errorOf(q: string): string {
  const parsed: ParsedLibraryQuery = parseLibraryQuery(q, opts);
  if (parsed.kind !== "error") throw new Error(JSON.stringify(parsed));
  return parsed.message;
}

/** Compact tree notation for assertions. */
function show(node: QueryNode): string {
  switch (node.type) {
    case "and":
      return `(${node.children.map(show).join(" & ")})`;
    case "or":
      return `(${node.children.map(show).join(" | ")})`;
    case "not":
      return `!${show(node.child)}`;
    case "text":
      return JSON.stringify(node.text);
    case "filter": {
      const f = node.filter;
      if (f.kind === "has") return `has:${f.property}`;
      if (f.kind === "tag") return `tag:${f.tag}`;
      if (f.place === "favorites") return `fav:${f.tag}`;
      if (f.place === "playlist") return `playlist:${f.name}`;
      return `in:${f.place}`;
    }
  }
}

describe("parseLibraryQuery", () => {
  it("leaves queries without filters to YouTube", () => {
    for (const q of [
      "lofi beats",
      "rock OR jazz",
      "-live concert",
      "Re:Zero season 2",
      "Nirvana :)",
      '"exact phrase" (unbalanced',
    ]) {
      expect(parseLibraryQuery(q, opts)).toEqual({ kind: "plain" });
      expect(hasLibraryFilter(q)).toBe(false);
    }
  });

  it("parses each filter kind", () => {
    expect(show(tree("has:memo"))).toBe("has:memo");
    expect(show(tree("tag:music"))).toBe("tag:music");
    expect(show(tree("tag:#Music"))).toBe("tag:music");
    expect(show(tree('tag:"Must Watch"'))).toBe("tag:must watch");
    for (const place of ["subscriptions", "saved", "queue", "history"]) {
      expect(show(tree(`in:${place}`))).toBe(`in:${place}`);
    }
    expect(show(tree("IN:Saved"))).toBe("in:saved");
    expect(show(tree('in:playlist:"Road Trip"'))).toBe("playlist:Road Trip");
    expect(show(tree("in:playlist:Chill"))).toBe("playlist:Chill");
  });

  it("reads in:favorites as the favorite tag in effect, and says so", () => {
    expect(show(tree("in:favorites"))).toBe("fav:favorite");
    const custom = library("in:favorites", { favoriteTag: "must watch" });
    expect(show(custom.tree)).toBe("fav:must watch");
    expect(custom.filters[0]?.label).toBe("in:favorites · #must watch");
    // tag: stays literal whatever the favorite tag is.
    expect(show(tree("tag:favorite", { favoriteTag: "must watch" }))).toBe(
      "tag:favorite",
    );
  });

  it("joins terms side by side with AND", () => {
    expect(show(tree("in:favorites tag:music"))).toBe(
      "(fav:favorite & tag:music)",
    );
  });

  it("reads OR as either", () => {
    expect(show(tree("tag:music OR tag:jazz"))).toBe("(tag:music | tag:jazz)");
    expect(show(tree("tag:a OR tag:b OR tag:c"))).toBe(
      "(tag:a | tag:b | tag:c)",
    );
  });

  it("binds OR tighter than the space", () => {
    expect(show(tree("has:memo tag:music OR tag:jazz"))).toBe(
      "(has:memo & (tag:music | tag:jazz))",
    );
    expect(show(tree("tag:music OR tag:jazz has:memo"))).toBe(
      "((tag:music | tag:jazz) & has:memo)",
    );
  });

  it("negates every kind of filter", () => {
    expect(show(tree("-tag:podcast"))).toBe("!tag:podcast");
    expect(show(tree("-in:history"))).toBe("!in:history");
    expect(show(tree("-has:memo"))).toBe("!has:memo");
    expect(show(tree("-in:favorites"))).toBe("!fav:favorite");
    expect(show(tree('-in:playlist:"Done"'))).toBe("!playlist:Done");
    const parsed = library("in:favorites tag:music -in:history");
    expect(parsed.filters.map((f) => [f.label, f.negated])).toEqual([
      ["in:favorites · #favorite", false],
      ["tag:music", false],
      ["-in:history", true],
    ]);
  });

  it("groups with brackets, negated groups too", () => {
    expect(show(tree("(tag:music OR tag:jazz) -tag:live"))).toBe(
      "((tag:music | tag:jazz) & !tag:live)",
    );
    expect(show(tree("-(tag:a OR tag:b)"))).toBe("!(tag:a | tag:b)");
    expect(library("-(tag:a OR -tag:b)").filters.map((f) => f.negated)).toEqual(
      [true, false],
    );
    expect(show(tree("((has:memo))"))).toBe("has:memo");
  });

  it("keeps words and quoted phrases, negated or not", () => {
    const parsed = library('has:memo deep house -live "boiler room"');
    expect(show(parsed.tree)).toBe(
      '(has:memo & "deep" & "house" & !"live" & "boiler room")',
    );
    expect(parsed.words).toEqual([
      { text: "deep", negated: false },
      { text: "house", negated: false },
      { text: "live", negated: true },
      { text: "boiler room", negated: false },
    ]);
    expect(show(tree('tag:music -"live at"'))).toBe('(tag:music & !"live at")');
    // A hyphen inside a word is part of it.
    expect(show(tree("tag:music lo-fi"))).toBe('(tag:music & "lo-fi")');
  });

  it("reports unknown filters instead of searching", () => {
    expect(errorOf("has:foo")).toBe("Unknown filter has:foo. Try has:memo.");
    expect(errorOf("in:nowhere")).toMatch(/^Unknown place in:nowhere\./);
    expect(errorOf("tag:")).toMatch(/tag: needs a tag/);
    expect(errorOf("tag:!!!")).toMatch(/tag: needs a tag/);
    expect(errorOf("in:playlist:")).toMatch(/needs a playlist name/);
    expect(errorOf("has:")).toMatch(/has: needs a property/);
  });

  it("reports unbalanced brackets and stray operators", () => {
    expect(errorOf("(tag:music OR tag:jazz")).toBe("A ( has no matching ).");
    expect(errorOf("tag:music)")).toBe("A ) has no matching (.");
    expect(errorOf("tag:music ()")).toBe("Empty brackets ().");
    expect(errorOf("tag:music OR")).toBe("OR needs something on both sides.");
    expect(errorOf("OR tag:music")).toBe("OR needs something on both sides.");
    expect(errorOf("tag:a OR OR tag:b")).toBe(
      "OR needs something on both sides.",
    );
    expect(errorOf('tag:a "open')).toBe('A " has no closing quote.');
  });
});

describe("removeFilterFromQuery", () => {
  it("drops the filter with its - and tidies what is left", () => {
    const q = "in:favorites tag:music -in:history";
    expect(removeFilterFromQuery(q, 2)).toBe("in:favorites tag:music");
    expect(removeFilterFromQuery(q, 0)).toBe("tag:music -in:history");
    expect(removeFilterFromQuery("tag:a OR tag:b", 0)).toBe("tag:b");
    expect(removeFilterFromQuery("tag:a OR tag:b", 1)).toBe("tag:a");
    expect(removeFilterFromQuery("(tag:a) live", 0)).toBe("live");
    expect(
      removeFilterFromQuery('(tag:a OR tag:b) -in:playlist:"Road trip"', 2),
    ).toBe("(tag:a OR tag:b)");
    expect(removeFilterFromQuery("-(tag:a) has:memo", 0)).toBe("has:memo");
  });
});

describe("matchesLibraryQuery", () => {
  const facts = (over: Partial<LibraryVideoFacts> = {}): LibraryVideoFacts => ({
    haystack: foldText("Café session · Some Channel"),
    places: new Set(),
    playlistNames: new Set(),
    channelTags: new Set(),
    hasMemo: false,
    ...over,
  });

  it("evaluates filters and words", () => {
    const v = facts({
      channelTags: new Set(["music", "favorite"]),
      places: new Set(["history"]),
      playlistNames: new Set(["road trip"]),
      hasMemo: true,
    });
    const yes = [
      "in:favorites tag:music",
      "tag:music OR tag:jazz",
      "has:memo cafe",
      'in:playlist:"ROAD TRIP"',
      "tag:music -live",
      "(tag:jazz OR has:memo) SESSION",
    ];
    const no = [
      "in:favorites tag:music -in:history",
      "tag:jazz",
      "-has:memo",
      "tag:music live",
      'in:playlist:"Other"',
    ];
    for (const q of yes) expect(matchesLibraryQuery(tree(q), v)).toBe(true);
    for (const q of no) expect(matchesLibraryQuery(tree(q), v)).toBe(false);
  });
});
