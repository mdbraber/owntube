import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYBACK_QUALITY,
  heightCapForDefaultQuality,
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

describe("heightCapForDefaultQuality", () => {
  it("defaults to a 1080 ceiling", () => {
    expect(heightCapForDefaultQuality(DEFAULT_PLAYBACK_QUALITY)).toBe(1080);
  });

  it("maps each numeric preference to its height", () => {
    expect(heightCapForDefaultQuality("720p")).toBe(720);
    expect(heightCapForDefaultQuality("480p")).toBe(480);
    expect(heightCapForDefaultQuality("360p")).toBe(360);
  });

  it("maps 360p-muxed to the same 360 ceiling (no muxed concept in DASH)", () => {
    expect(heightCapForDefaultQuality("360p-muxed")).toBe(360);
  });

  it("returns null (uncapped) for best", () => {
    expect(heightCapForDefaultQuality("best")).toBeNull();
  });
});
