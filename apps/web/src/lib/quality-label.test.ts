import { describe, expect, it } from "vitest";
import { qualityLabel } from "@/lib/quality-label";

describe("qualityLabel", () => {
  it("names 16:9 rungs by their height", () => {
    expect(qualityLabel(1920, 1080)).toBe("1080p");
    expect(qualityLabel(1280, 720)).toBe("720p");
    expect(qualityLabel(3840, 2160)).toBe("2160p");
    expect(qualityLabel(426, 240)).toBe("240p");
    expect(qualityLabel(256, 144)).toBe("144p");
  });

  it("names wider frames by the 16:9 box they fill, as YouTube does", () => {
    // cc5C8hRblBY's 2:1 ladder.
    expect(qualityLabel(1920, 960)).toBe("1080p");
    expect(qualityLabel(1280, 640)).toBe("720p");
    expect(qualityLabel(854, 428)).toBe("480p");
    expect(qualityLabel(640, 320)).toBe("360p");
    expect(qualityLabel(426, 214)).toBe("240p");
    expect(qualityLabel(256, 128)).toBe("144p");
    expect(qualityLabel(1920, 804)).toBe("1080p");
  });

  it("names vertical and 4:3 frames by their short side", () => {
    expect(qualityLabel(1080, 1920)).toBe("1080p");
    expect(qualityLabel(720, 1280)).toBe("720p");
    expect(qualityLabel(640, 480)).toBe("480p");
    expect(qualityLabel(1440, 1080)).toBe("1080p");
  });

  it("falls back to the height without a width", () => {
    expect(qualityLabel(0, 720)).toBe("720p");
    expect(qualityLabel(0, 0)).toBe("?");
  });
});
