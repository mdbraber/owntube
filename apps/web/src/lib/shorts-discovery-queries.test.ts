import { describe, expect, it } from "vitest";
import {
  shortsSearchQueriesForRegion,
  shortsSearchQueriesForTaste,
} from "@/lib/shorts-discovery-queries";

describe("shortsSearchQueriesForRegion", () => {
  it("returns French queries for FR", () => {
    const q = shortsSearchQueriesForRegion("FR");
    expect(q[0]).toContain("français");
    expect(q).not.toContain("#shorts");
  });

  it("falls back for unknown region", () => {
    expect(shortsSearchQueriesForRegion("ZZ")).toEqual([
      "#shorts",
      "shorts",
      "youtube shorts",
    ]);
  });
});

describe("shortsSearchQueriesForTaste", () => {
  it("builds queries from corpus titles and skips viral regional", () => {
    const q = shortsSearchQueriesForTaste(
      ["Rust survival gameplay", "mechanical keyboard"],
      "US",
    );
    expect(q.some((line) => line.includes("Rust"))).toBe(true);
    expect(q.every((line) => !line.toLowerCase().includes("viral"))).toBe(true);
  });
});
