import { describe, expect, it } from "vitest";
import {
  scrubFrameMarkers,
  storyboardThumbAtTime,
  ytimgScrubFrameUrl,
} from "./video-scrub-frames";

describe("scrubFrameMarkers", () => {
  it("emits markers every 5 seconds including the end", () => {
    expect(scrubFrameMarkers(12, 5)).toEqual([0, 5, 10, 12]);
  });
});

describe("ytimgScrubFrameUrl", () => {
  it("maps time to one of four keyframes", () => {
    expect(ytimgScrubFrameUrl("abc", 0, 100)).toContain("/abc/0.jpg");
    expect(ytimgScrubFrameUrl("abc", 99, 100)).toContain("/abc/3.jpg");
  });
});

describe("storyboardThumbAtTime", () => {
  it("computes sheet and tile indices", () => {
    const sb = {
      templateUrl: "https://i.ytimg.com/sb/vid/storyboard3_L0/$M.jpg",
      thumbWidth: 160,
      thumbHeight: 90,
      count: 100,
      intervalMs: 5000,
      columns: 5,
      rows: 5,
      storyboardCount: 4,
    };
    expect(storyboardThumbAtTime(sb, 0)).toEqual({
      sheetIndex: 0,
      column: 0,
      row: 0,
    });
    expect(storyboardThumbAtTime(sb, 30).sheetIndex).toBe(0);
    expect(storyboardThumbAtTime(sb, 30)).toMatchObject({
      column: 1,
      row: 1,
    });
  });
});
