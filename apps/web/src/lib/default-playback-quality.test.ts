import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYBACK_QUALITY,
  heightCapForDefaultQuality,
} from "@/lib/default-playback-quality";

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
