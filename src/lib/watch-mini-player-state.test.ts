import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWatchMiniStateForOtherVideo,
  readWatchMiniEnabled,
  readWatchMiniState,
  WATCH_MINI_ENABLED_KEY,
  WATCH_MINI_STATE_KEY,
  writeWatchMiniEnabled,
  writeWatchMiniState,
} from "@/lib/watch-mini-player-state";

function createStorageMock() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("watch-mini-player-state", () => {
  beforeEach(() => {
    const storage = createStorageMock();
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips mini state with quality and media prefs", () => {
    writeWatchMiniState({
      videoId: "abc",
      title: "Test",
      payload: { mode: "hls", src: "https://example.com/v.m3u8" },
      currentTime: 42.5,
      qualityIndex: 2,
      volume: 0.6,
      muted: false,
      paused: true,
    });
    const read = readWatchMiniState();
    expect(read).toEqual({
      videoId: "abc",
      title: "Test",
      payload: { mode: "hls", src: "https://example.com/v.m3u8" },
      currentTime: 42.5,
      qualityIndex: 2,
      volume: 0.6,
      muted: false,
      paused: true,
    });
  });

  it("rejects invalid stored state", () => {
    window.localStorage.setItem(WATCH_MINI_STATE_KEY, '{"videoId":1}');
    expect(readWatchMiniState()).toBeNull();
  });

  it("clears playback state when mini player is disabled", () => {
    writeWatchMiniState({
      videoId: "x",
      title: "X",
      payload: { mode: "hls", src: "https://example.com/a.m3u8" },
      currentTime: 0,
    });
    writeWatchMiniEnabled(false);
    expect(readWatchMiniState()).toBeNull();
    expect(readWatchMiniEnabled()).toBe(false);
    expect(window.localStorage.getItem(WATCH_MINI_ENABLED_KEY)).toBe("0");
  });

  it("clearWatchMiniStateForOtherVideo removes stale video", () => {
    writeWatchMiniState({
      videoId: "old",
      title: "Old",
      payload: { mode: "hls", src: "https://example.com/old.m3u8" },
      currentTime: 10,
    });
    clearWatchMiniStateForOtherVideo("new");
    expect(readWatchMiniState()).toBeNull();
  });

  it("clearWatchMiniStateForOtherVideo keeps same video", () => {
    writeWatchMiniState({
      videoId: "same",
      title: "Same",
      payload: { mode: "hls", src: "https://example.com/s.m3u8" },
      currentTime: 5,
    });
    clearWatchMiniStateForOtherVideo("same");
    expect(readWatchMiniState()?.videoId).toBe("same");
  });
});
