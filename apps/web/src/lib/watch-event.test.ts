import { describe, expect, it } from "vitest";
import { COMPLETION_RATIO, computeWatchEvent } from "@/lib/watch-event";

describe("computeWatchEvent", () => {
  it("reports honest dwell and no completion for a short visit on a long video", () => {
    expect(computeWatchEvent(8, 600, false)).toEqual({
      durationWatched: 8,
      completed: false,
    });
  });

  it("never completes on dwell alone - lingering is not watching", () => {
    expect(computeWatchEvent(590, 600, false)).toEqual({
      durationWatched: 590,
      completed: false,
    });
    expect(
      computeWatchEvent(600 * COMPLETION_RATIO, 600, false).completed,
    ).toBe(false);
    // Dwell past the whole length with the playhead stuck early: still not
    // watched (a mini player left running, a rewatched section).
    expect(computeWatchEvent(900, 600, false, 45).completed).toBe(false);
  });

  it("caps durationWatched at the video length", () => {
    expect(computeWatchEvent(900, 600, false)).toEqual({
      durationWatched: 600,
      completed: false,
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

  it("completes on playback position even when dwell is short", () => {
    // Watched at 2x, or with sponsor segments skipped: half the dwell, but the
    // playhead reached the end — that is a finished video.
    expect(computeWatchEvent(300, 600, false, 600).completed).toBe(true);
    // Scrubbed to the end.
    expect(computeWatchEvent(20, 600, false, 590).completed).toBe(true);
  });

  it("does not complete from a position short of the ratio", () => {
    expect(computeWatchEvent(20, 600, false, 300).completed).toBe(false);
  });

  it("does not complete on dwell even when no position is known", () => {
    // No readable playhead (player torn down, preview element): dwell alone
    // must still not mark it watched - that was the linger-completion bug.
    expect(computeWatchEvent(600, 600, false).completed).toBe(false);
    expect(computeWatchEvent(600, 600, false, undefined).completed).toBe(false);
  });

  it("never completes live streams", () => {
    expect(computeWatchEvent(9999, 600, true, 9999).completed).toBe(false);
  });
});
