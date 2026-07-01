import { describe, expect, it } from "vitest";
import {
  mergeSeenShortEntries,
  SEEN_SHORTS_TTL_MS,
} from "@/lib/shorts-seen-storage";

const NOW = 1_750_000_000_000;

function ids(entries: { id: string; seenAt: number }[]): string[] {
  return entries.map((e) => e.id);
}

describe("mergeSeenShortEntries", () => {
  it("appends new ids while de-duplicating", () => {
    const merged = mergeSeenShortEntries(
      [
        { id: "aaaaa", seenAt: NOW - 1000 },
        { id: "bbbbb", seenAt: NOW - 1000 },
      ],
      ["bbbbb", "ccccc"],
      NOW,
    );
    expect(ids(merged)).toEqual(["aaaaa", "bbbbb", "ccccc"]);
  });

  it("refreshes the timestamp of a re-seen id", () => {
    const merged = mergeSeenShortEntries(
      [{ id: "aaaaa", seenAt: NOW - 1_000_000 }],
      ["aaaaa"],
      NOW,
    );
    expect(merged).toEqual([{ id: "aaaaa", seenAt: NOW }]);
  });

  it("prunes entries older than the TTL", () => {
    const merged = mergeSeenShortEntries(
      [
        { id: "stale1", seenAt: NOW - SEEN_SHORTS_TTL_MS - 1 },
        { id: "fresh1", seenAt: NOW - 1000 },
      ],
      [],
      NOW,
    );
    expect(ids(merged)).toEqual(["fresh1"]);
  });

  it("drops ids shorter than 5 chars", () => {
    expect(ids(mergeSeenShortEntries([], ["abc", "validId"], NOW))).toEqual([
      "validId",
    ]);
  });

  it("keeps the most recent ids when capping", () => {
    const merged = mergeSeenShortEntries(
      [
        { id: "aaaaa", seenAt: NOW - 2000 },
        { id: "bbbbb", seenAt: NOW - 1000 },
      ],
      ["ccccc"],
      NOW,
      2,
    );
    expect(ids(merged)).toEqual(["bbbbb", "ccccc"]);
  });

  it("trims whitespace", () => {
    expect(ids(mergeSeenShortEntries([], ["  spaced01  "], NOW))).toEqual([
      "spaced01",
    ]);
  });
});
