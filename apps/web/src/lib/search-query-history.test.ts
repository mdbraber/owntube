import { describe, expect, it } from "vitest";
import { filterSearchQueryHistory } from "@/lib/search-query-history";

describe("filterSearchQueryHistory", () => {
  it("returns recent-first matches for a prefix", () => {
    const out = filterSearchQueryHistory(
      ["cats", "cat videos", "dogs", "catalog"],
      "cat",
      10,
    );
    expect(out).toEqual(["catalog", "cat videos", "cats"]);
  });

  it("returns full history when prefix is empty", () => {
    const out = filterSearchQueryHistory(["a", "b", "c"], "", 10);
    expect(out).toEqual(["c", "b", "a"]);
  });

  it("dedupes case-insensitively", () => {
    const out = filterSearchQueryHistory(["Test", "test", "TESTING"], "te", 10);
    expect(out).toEqual(["TESTING", "test"]);
  });
});
