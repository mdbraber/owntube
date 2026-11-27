import { describe, expect, it } from "vitest";
import { prefersNativeHls } from "@/lib/native-hls";

describe("prefersNativeHls", () => {
  it("plays natively on an iPhone (no real Media Source)", () => {
    expect(
      prefersNativeHls({
        canPlayNativeHls: true,
        hasRealMediaSource: false,
        iosLike: true,
      }),
    ).toBe(true);
  });

  it("plays natively on an iPad in desktop mode, so AirPlay can take it", () => {
    expect(
      prefersNativeHls({
        canPlayNativeHls: true,
        hasRealMediaSource: true,
        iosLike: true,
      }),
    ).toBe(true);
  });

  it("keeps hls.js on a real Mac", () => {
    expect(
      prefersNativeHls({
        canPlayNativeHls: true,
        hasRealMediaSource: true,
        iosLike: false,
      }),
    ).toBe(false);
  });

  it("keeps hls.js where the browser has no native HLS", () => {
    expect(
      prefersNativeHls({
        canPlayNativeHls: false,
        hasRealMediaSource: true,
        iosLike: false,
      }),
    ).toBe(false);
    expect(
      prefersNativeHls({
        canPlayNativeHls: false,
        hasRealMediaSource: false,
        iosLike: true,
      }),
    ).toBe(false);
  });
});
