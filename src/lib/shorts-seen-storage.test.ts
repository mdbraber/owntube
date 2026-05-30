import { describe, expect, it } from "vitest";
import { mergeSeenShortIds } from "@/lib/shorts-seen-storage";

describe("mergeSeenShortIds", () => {
  it("appends new ids while de-duplicating", () => {
    expect(mergeSeenShortIds(["aaaaa", "bbbbb"], ["bbbbb", "ccccc"])).toEqual([
      "aaaaa",
      "bbbbb",
      "ccccc",
    ]);
  });

  it("drops ids shorter than 5 chars", () => {
    expect(mergeSeenShortIds([], ["abc", "validId"])).toEqual(["validId"]);
  });

  it("keeps the most recent ids when capping", () => {
    expect(mergeSeenShortIds(["aaaaa", "bbbbb"], ["ccccc"], 2)).toEqual([
      "bbbbb",
      "ccccc",
    ]);
  });

  it("trims whitespace", () => {
    expect(mergeSeenShortIds([], ["  spaced01  "])).toEqual(["spaced01"]);
  });
});
