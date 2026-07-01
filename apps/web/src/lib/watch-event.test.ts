import { describe, expect, it } from "vitest";
import { COMPLETION_RATIO, computeWatchEvent } from "@/lib/watch-event";

describe("computeWatchEvent", () => {
  it("reports honest dwell and no completion for a short visit on a long video", () => {
    expect(computeWatchEvent(8, 600, false)).toEqual({
      durationWatched: 8,
      completed: false,
    });
  });

  it("marks completion once dwell crosses the ratio threshold", () => {
    expect(computeWatchEvent(540, 600, false)).toEqual({
      durationWatched: 540,
      completed: true,
    });
    expect(computeWatchEvent(509, 600, false).completed).toBe(false);
    expect(
      computeWatchEvent(600 * COMPLETION_RATIO, 600, false).completed,
    ).toBe(true);
  });

  it("caps durationWatched at the video length", () => {
    expect(computeWatchEvent(900, 600, false)).toEqual({
      durationWatched: 600,
      completed: true,
    });
  });

  it("never completes when the video length is unknown", () => {
    expect(computeWatchEvent(3600, 0, false)).toEqual({
      durationWatched: 3600,
      completed: false,
    });
  });

  it("uses session dwell uncapped and never completes for live streams", () => {
    expect(computeWatchEvent(1234, 600, true)).toEqual({
      durationWatched: 1234,
      completed: false,
    });
  });

  it("clamps negative and fractional dwell", () => {
    expect(computeWatchEvent(-5, 600, false)).toEqual({
      durationWatched: 0,
      completed: false,
    });
    expect(computeWatchEvent(12.9, 600, false).durationWatched).toBe(12);
  });
});
