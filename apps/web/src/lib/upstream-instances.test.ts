import { describe, expect, it } from "vitest";
import {
  normalizePreferredUpstreamInstance,
  normalizeUpstreamInstanceList,
} from "@/lib/upstream-instances";

describe("upstream instance normalization", () => {
  it("deduplicates, trims trailing slashes, and drops disabled values", () => {
    expect(
      normalizeUpstreamInstanceList([
        " https://piped.example/ ",
        "https://piped.example",
        "disabled",
        "",
        "https://other.example///",
      ]),
    ).toEqual(["https://piped.example", "https://other.example"]);
  });

  it("keeps preferred URL only when it belongs to the normalized list", () => {
    const instances = ["https://one.example", "https://two.example"];
    expect(
      normalizePreferredUpstreamInstance("https://two.example/", instances),
    ).toBe("https://two.example");
    expect(
      normalizePreferredUpstreamInstance("https://missing.example", instances),
    ).toBeUndefined();
  });
});
