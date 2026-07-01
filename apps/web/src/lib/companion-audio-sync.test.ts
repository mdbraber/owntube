import { describe, expect, it } from "vitest";
import {
  applyCompanionAudioSync,
  companionAudioSyncThresholds,
} from "@/lib/companion-audio-sync";

function mockMedia(currentTime: number, playbackRate: number) {
  return {
    currentTime,
    playbackRate,
  } as HTMLMediaElement;
}

describe("companionAudioSyncThresholds", () => {
  it("allows more drift before hard snap at 2×", () => {
    const at1 = companionAudioSyncThresholds(1);
    const at2 = companionAudioSyncThresholds(2);
    expect(at2.driftHard).toBeGreaterThan(at1.driftHard);
    expect(at2.recoveryIntervalMs).toBeGreaterThan(at1.recoveryIntervalMs);
  });
});

describe("applyCompanionAudioSync", () => {
  it("hard-aligns on force", () => {
    const video = mockMedia(10, 2);
    const audio = mockMedia(9, 1);
    applyCompanionAudioSync(
      video as HTMLVideoElement,
      audio as HTMLAudioElement,
      { force: true },
    );
    expect(audio.currentTime).toBe(10);
    expect(audio.playbackRate).toBe(2);
  });

  it("nudges playbackRate at 2× for moderate drift", () => {
    const video = mockMedia(10, 2);
    const audio = mockMedia(10.25, 2);
    applyCompanionAudioSync(
      video as HTMLVideoElement,
      audio as HTMLAudioElement,
    );
    expect(audio.currentTime).toBe(10.25);
    expect(audio.playbackRate).toBeLessThan(2);
    expect(audio.playbackRate).toBeCloseTo(2 * 0.965, 5);
  });

  it("hard-aligns at 1× for moderate drift", () => {
    const video = mockMedia(10, 1);
    const audio = mockMedia(10.2, 1);
    applyCompanionAudioSync(
      video as HTMLVideoElement,
      audio as HTMLAudioElement,
    );
    expect(audio.currentTime).toBe(10);
    expect(audio.playbackRate).toBe(1);
  });

  it("hard-aligns at 2× when drift is very large", () => {
    const video = mockMedia(10, 2);
    const audio = mockMedia(11, 2);
    applyCompanionAudioSync(
      video as HTMLVideoElement,
      audio as HTMLAudioElement,
    );
    expect(audio.currentTime).toBe(10);
    expect(audio.playbackRate).toBe(2);
  });
});
