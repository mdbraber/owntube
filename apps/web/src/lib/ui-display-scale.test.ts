import { describe, expect, it } from "vitest";
import {
  getOsDisplayScale,
  getUiFontScalePercent,
  isOsDisplayScalingActive,
} from "./ui-display-scale";

describe("getOsDisplayScale", () => {
  it("returns ratio of screen to inner width", () => {
    expect(getOsDisplayScale(2160, 1080)).toBe(2);
    expect(getOsDisplayScale(2560, 2560)).toBe(1);
  });
});

describe("isOsDisplayScalingActive", () => {
  it("detects 200% OS scale via screen ratio", () => {
    expect(isOsDisplayScalingActive(2160, 1080, 2)).toBe(true);
  });

  it("detects scaled HiDPI via dpr when screen ratio is unavailable", () => {
    expect(isOsDisplayScalingActive(1080, 1080, 2)).toBe(true);
  });

  it("is false on native 1440p at 100%", () => {
    expect(isOsDisplayScalingActive(2560, 2560, 1)).toBe(false);
    expect(isOsDisplayScalingActive(2160, 2160, 1)).toBe(false);
  });
});

describe("getUiFontScalePercent", () => {
  it("stays at 100% when OS scaling is active", () => {
    expect(getUiFontScalePercent(1080, 720, 2160, 2)).toBe(100);
  });

  it("upscales on large native viewports", () => {
    expect(getUiFontScalePercent(2560, 1440, 2560, 1)).toBe(125);
    expect(getUiFontScalePercent(2160, 1440, 2160, 1)).toBe(118);
  });
});
