import { describe, expect, it } from "vitest";
import { gatewayImageUrl, toImages } from "./images.ts";
import { exactCount, parseClock, parseCount } from "./text.ts";

describe("exactCount", () => {
  it("keeps exact numbers and drops what YouTube leaves out", () => {
    expect(exactCount(42)).toEqual({ value: 42, approximate: false });
    expect(exactCount(0)).toEqual({ value: 0, approximate: false });
    expect(exactCount(null)).toBeUndefined();
    expect(exactCount(undefined)).toBeUndefined();
    expect(exactCount(Number.NaN)).toBeUndefined();
    expect(exactCount(-1)).toBeUndefined();
  });
});

describe("parseCount", () => {
  it("reads exact and abbreviated counts", () => {
    expect(parseCount("1,841,079,665 views")).toEqual({
      value: 1_841_079_665,
      approximate: false,
    });
    expect(parseCount("1.6M views")).toEqual({
      value: 1_600_000,
      approximate: true,
    });
    expect(parseCount("122K")).toEqual({ value: 122_000, approximate: true });
    expect(parseCount("4.56M subscribers")).toEqual({
      value: 4_560_000,
      approximate: true,
    });
    expect(parseCount("1 view")).toEqual({ value: 1, approximate: false });
    expect(parseCount("No views")).toEqual({ value: 0, approximate: false });
  });

  it("returns nothing for text without a number", () => {
    expect(parseCount("Premieres soon")).toBeUndefined();
    expect(parseCount(undefined)).toBeUndefined();
  });
});

describe("parseClock", () => {
  it("reads durations", () => {
    expect(parseClock("15:16")).toBe(916);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("LIVE")).toBeUndefined();
  });
});

describe("gatewayImageUrl", () => {
  it("maps YouTube's image hosts onto the gateway, query included", () => {
    expect(
      gatewayImageUrl("https://i.ytimg.com/vi/abc/hq720.jpg?sqp=x&rs=y"),
    ).toBe("/media/img/yti/vi/abc/hq720.jpg?sqp=x&rs=y");
    expect(gatewayImageUrl("//yt3.googleusercontent.com/ytc/a=s88")).toBe(
      "/media/img/yt3gu/ytc/a=s88",
    );
    expect(gatewayImageUrl("https://yt3.ggpht.com/x=s68")).toBe(
      "/media/img/yt3/x=s68",
    );
  });

  it("drops images from any other host", () => {
    expect(gatewayImageUrl("https://evil.example/x.jpg")).toBeUndefined();
    expect(
      toImages([
        { url: "https://evil.example/x.jpg" },
        { url: "https://i.ytimg.com/vi/a/b.jpg", width: 1 },
      ]),
    ).toEqual([{ url: "/media/img/yti/vi/a/b.jpg", width: 1 }]);
  });
});
