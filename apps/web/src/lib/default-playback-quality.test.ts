import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYBACK_QUALITY,
  variantIndexForDefaultQuality,
} from "@/lib/default-playback-quality";

describe("variantIndexForDefaultQuality", () => {
  const variants = [
    { label: "1080p", t: "split" },
    { label: "720p", t: "split" },
    { label: "360p", t: "muxed" },
  ];

  it("defaults to 1080p row", () => {
    expect(
      variantIndexForDefaultQuality(variants, DEFAULT_PLAYBACK_QUALITY),
    ).toBe(0);
  });

  it("finds muxed 360p when requested", () => {
    expect(variantIndexForDefaultQuality(variants, "360p-muxed")).toBe(2);
  });

  it("finds 720p when requested", () => {
    expect(variantIndexForDefaultQuality(variants, "720p")).toBe(1);
  });
});
