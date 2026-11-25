import { describe, expect, it } from "vitest";
import { nativeHlsSrc, prefersNativeHls } from "@/lib/native-hls";

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

describe("nativeHlsSrc", () => {
  it("asks the master for the playlist native players take", () => {
    expect(
      nativeHlsSrc(
        "https://owntube-media.example.org/hls/Em6tbhj9o6A/master.m3u8",
      ),
    ).toBe(
      "https://owntube-media.example.org/hls/Em6tbhj9o6A/master.m3u8?for=cast",
    );
  });

  it("keeps a relative master relative", () => {
    expect(nativeHlsSrc("/hls/Em6tbhj9o6A/master.m3u8")).toBe(
      "/hls/Em6tbhj9o6A/master.m3u8?for=cast",
    );
  });

  it("does not add the parameter twice", () => {
    expect(
      nativeHlsSrc("https://m.example.org/hls/abc123/master.m3u8?for=cast"),
    ).toBe("https://m.example.org/hls/abc123/master.m3u8?for=cast");
  });

  it("leaves other sources alone", () => {
    const other = "https://m.example.org/live/abc123/index.m3u8";
    expect(nativeHlsSrc(other)).toBe(other);
  });
});
