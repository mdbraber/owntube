import { describe, expect, it } from "vitest";
import { LIVE_IDLE_STOP_MS, shouldStopIdleLive } from "@/lib/live-idle-stop";

describe("shouldStopIdleLive", () => {
  const start = 1_000_000;

  it("is three hours", () => {
    expect(LIVE_IDLE_STOP_MS).toBe(3 * 60 * 60 * 1000);
  });

  it("keeps a live stream playing before the idle limit", () => {
    expect(shouldStopIdleLive(start, start, true)).toBe(false);
    expect(shouldStopIdleLive(start, start + LIVE_IDLE_STOP_MS - 1, true)).toBe(
      false,
    );
  });

  it("stops a live stream at and after the idle limit", () => {
    expect(shouldStopIdleLive(start, start + LIVE_IDLE_STOP_MS, true)).toBe(
      true,
    );
    expect(shouldStopIdleLive(start, start + 5 * LIVE_IDLE_STOP_MS, true)).toBe(
      true,
    );
  });

  it("never stops VOD", () => {
    expect(
      shouldStopIdleLive(start, start + 5 * LIVE_IDLE_STOP_MS, false),
    ).toBe(false);
  });
});
