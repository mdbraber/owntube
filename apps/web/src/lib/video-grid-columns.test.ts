import { describe, expect, it } from "vitest";
import {
  averageLargeVideoColumnWidthPx,
  computeHomeShortsShelfLayout,
  countGridTemplateColumns,
  parseFirstGridColumnWidthPx,
} from "@/lib/video-grid-columns";

describe("countGridTemplateColumns", () => {
  it("counts resolved pixel tracks", () => {
    expect(countGridTemplateColumns("232.5px 232.5px 232.5px 232.5px")).toBe(4);
  });

  it("falls back to 1 for empty or none", () => {
    expect(countGridTemplateColumns("")).toBe(1);
    expect(countGridTemplateColumns("none")).toBe(1);
  });
});

describe("parseFirstGridColumnWidthPx", () => {
  it("reads the first px track", () => {
    expect(parseFirstGridColumnWidthPx("312.5px 312.5px")).toBe(312.5);
  });

  it("returns null for fr-only templates", () => {
    expect(parseFirstGridColumnWidthPx("1fr 1fr")).toBeNull();
  });
});

describe("averageLargeVideoColumnWidthPx", () => {
  it("subtracts gaps between columns", () => {
    expect(averageLargeVideoColumnWidthPx(1280, 4)).toBe((1280 - 3 * 28) / 4);
  });
});

describe("computeHomeShortsShelfLayout", () => {
  it("uses 1.5 shorts per column and fills the full row width", () => {
    const containerWidth = 4 * 300 + 3 * 28;
    const layout = computeHomeShortsShelfLayout(4, 300, containerWidth);
    expect(layout.displayCount).toBe(6);
    expect(layout.shortWidthPx * 6 + 5 * 28).toBeCloseTo(containerWidth);
  });

  it("scales count down on narrow layouts", () => {
    const layout = computeHomeShortsShelfLayout(1, 280, 280);
    expect(layout.displayCount).toBe(2);
    expect(layout.shortWidthPx * 2 + 28).toBeCloseTo(280);
  });
});
