import { describe, expect, it } from "vitest";
import { mergeSearchSuggestions } from "@/lib/search-suggestions-list";

describe("mergeSearchSuggestions", () => {
  it("prefers history then upstream without duplicates", () => {
    const out = mergeSearchSuggestions(
      "lofi",
      ["lofi hip hop", "lofi beats"],
      ["lofi hip hop", "lofi radio", "lofi"],
      10,
    );
    expect(out).toEqual(["lofi hip hop", "lofi beats", "lofi radio"]);
  });
});
