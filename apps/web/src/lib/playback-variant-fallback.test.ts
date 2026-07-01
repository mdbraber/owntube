import { describe, expect, it } from "vitest";
import { nextPlaybackVariantIndex } from "@/lib/playback-variant-fallback";

describe("nextPlaybackVariantIndex", () => {
  it("returns the next index when more variants exist", () => {
    expect(nextPlaybackVariantIndex(0, 3)).toBe(1);
    expect(nextPlaybackVariantIndex(1, 3)).toBe(2);
  });

  it("returns null on the last variant", () => {
    expect(nextPlaybackVariantIndex(2, 3)).toBeNull();
  });

  it("returns null for invalid inputs", () => {
    expect(nextPlaybackVariantIndex(-1, 3)).toBeNull();
    expect(nextPlaybackVariantIndex(0, 0)).toBeNull();
    expect(nextPlaybackVariantIndex(3, 3)).toBeNull();
  });
});
