import { describe, expect, it } from "vitest";
import {
  type LibraryVocabulary,
  libraryFilterSuggestions,
} from "@/lib/library-search-suggestions";

const vocab: LibraryVocabulary = {
  favoriteTag: "must watch",
  tags: [
    { tag: "jazz", count: 3 },
    { tag: "music", count: 12 },
    { tag: "must watch", count: 1 },
  ],
  playlists: [{ name: "Road Trip" }, { name: "Chill" }],
};

const values = (q: string) =>
  libraryFilterSuggestions(q, vocab).map((s) => s.value);
const labels = (q: string) =>
  libraryFilterSuggestions(q, vocab).map((s) => s.label);

describe("libraryFilterSuggestions", () => {
  it("offers memo for has:", () => {
    expect(values("has:")).toEqual(["has:memo "]);
    expect(values("has:me")).toEqual(["has:memo "]);
    expect(values("has:memo")).toEqual([]);
  });

  it("offers the user's tags for tag:, quoted when needed", () => {
    expect(values("tag:")).toEqual([
      "tag:jazz ",
      "tag:music ",
      'tag:"must watch" ',
    ]);
    expect(values("in:saved tag:mu")).toEqual([
      "in:saved tag:music ",
      'in:saved tag:"must watch" ',
    ]);
  });

  it("offers places for in:, naming the favorite tag", () => {
    expect(labels("in:")).toEqual([
      "in:favorites · #must watch",
      "in:subscriptions",
      "in:saved",
      "in:queue",
      "in:history",
      "in:playlist:",
      'in:playlist:"Road Trip"',
      'in:playlist:"Chill"',
    ]);
    expect(values("in:fav")).toEqual(["in:favorites "]);
  });

  it("completes playlist names, inside quotes too", () => {
    expect(values("in:playlist:")).toEqual([
      'in:playlist:"Road Trip" ',
      'in:playlist:"Chill" ',
    ]);
    expect(values('in:playlist:"road t')).toEqual(['in:playlist:"Road Trip" ']);
  });

  it("keeps a leading - or ( and what came before", () => {
    expect(values("tag:music -in:hi")).toEqual(["tag:music -in:history "]);
    expect(labels("(tag:j")).toEqual(["(tag:jazz"]);
  });

  it("stays quiet when the end of the query is no filter", () => {
    expect(values("lofi beats")).toEqual([]);
    expect(values("has:memo ")).toEqual([]);
    expect(values("re:zero")).toEqual([]);
  });
});
