import { describe, expect, it } from "vitest";
import {
  applyVideoThumbnailImgError,
  isLowerTierVideoThumbnailFilename,
  nextFallbackVideoThumbnailUrl,
  preferHighResVideoThumbnailUrl,
} from "@/lib/video-thumbnail-url";

describe("video-thumbnail-url", () => {
  it("does not upgrade signed Piped hq720 thumbs (rs is tier-specific)", () => {
    const raw =
      "http://192.168.1.11:8092/vi/abc123/hq720.jpg?host=i.ytimg.com&rs=sig";
    expect(preferHighResVideoThumbnailUrl(raw, "abc123")).toBe(raw);
  });

  it("does not upgrade unsigned Piped instance thumbs", () => {
    const raw = "https://piped.test/vi/abcdefghijk/hqdefault.jpg";
    expect(preferHighResVideoThumbnailUrl(raw, "abcdefghijk")).toBe(raw);
  });

  it("upgrades direct YouTube hq720 to maxresdefault", () => {
    const raw = "https://i.ytimg.com/vi/abc123/hq720.jpg";
    expect(preferHighResVideoThumbnailUrl(raw, "abc123")).toBe(
      "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
    );
  });

  it("defaults videoId-only thumbs to hqdefault", () => {
    expect(preferHighResVideoThumbnailUrl(undefined, "abc123")).toBe(
      "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    );
  });

  it("leaves maxres URLs unchanged", () => {
    const raw =
      "http://192.168.1.11:8092/bp/abc123/maxresdefault.webp?host=i.ytimg.com";
    expect(preferHighResVideoThumbnailUrl(raw)).toBe(raw);
  });

  it("detects lower-tier filenames", () => {
    expect(isLowerTierVideoThumbnailFilename("hq720.jpg")).toBe(true);
    expect(isLowerTierVideoThumbnailFilename("maxresdefault.jpg")).toBe(false);
  });

  it("falls back from maxres to hqdefault on img error", () => {
    const raw = "https://i.ytimg.com/vi/x/maxresdefault.jpg";
    expect(nextFallbackVideoThumbnailUrl(raw)).toBe(
      "https://i.ytimg.com/vi/x/hqdefault.jpg",
    );
  });

  it("falls back signed Piped maxres to YouTube hqdefault (drops invalid rs)", () => {
    const raw =
      "http://192.168.1.11:8092/vi/abc123/maxresdefault.jpg?host=i.ytimg.com&rs=sig";
    expect(nextFallbackVideoThumbnailUrl(raw)).toBe(
      "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    );
  });

  it("falls back unsigned Piped thumbs on same origin without query", () => {
    const raw = "https://piped.test/vi/abc123/maxresdefault.jpg";
    expect(nextFallbackVideoThumbnailUrl(raw)).toBe(
      "https://piped.test/vi/abc123/hqdefault.jpg",
    );
  });

  it("chains fallbacks through sddefault to default.jpg", () => {
    const chain = [
      "https://i.ytimg.com/vi/x/maxresdefault.jpg",
      "https://i.ytimg.com/vi/x/hqdefault.jpg",
      "https://i.ytimg.com/vi/x/mqdefault.jpg",
      "https://i.ytimg.com/vi/x/sddefault.jpg",
      "https://i.ytimg.com/vi/x/default.jpg",
    ] as const;
    for (let i = 0; i < chain.length - 1; i++) {
      expect(nextFallbackVideoThumbnailUrl(chain[i])).toBe(chain[i + 1]);
    }
    expect(
      nextFallbackVideoThumbnailUrl(chain[chain.length - 1]),
    ).toBeUndefined();
  });

  it("falls back maxres webp to hqdefault webp", () => {
    const raw = "https://i.ytimg.com/vi/x/maxresdefault.webp";
    expect(nextFallbackVideoThumbnailUrl(raw)).toBe(
      "https://i.ytimg.com/vi/x/hqdefault.webp",
    );
  });

  it("applyVideoThumbnailImgError steps down until exhausted", () => {
    const el = {
      src: "https://i.ytimg.com/vi/x/maxresdefault.jpg",
      dataset: {} as DOMStringMap,
    } as HTMLImageElement;

    applyVideoThumbnailImgError(el);
    expect(el.src).toBe("https://i.ytimg.com/vi/x/hqdefault.jpg");
    expect(el.dataset.fallbackSteps).toBe("1");

    applyVideoThumbnailImgError(el);
    expect(el.src).toBe("https://i.ytimg.com/vi/x/mqdefault.jpg");
    expect(el.dataset.fallbackSteps).toBe("2");

    applyVideoThumbnailImgError(el);
    expect(el.src).toBe("https://i.ytimg.com/vi/x/sddefault.jpg");
    applyVideoThumbnailImgError(el);
    expect(el.src).toBe("https://i.ytimg.com/vi/x/default.jpg");
    applyVideoThumbnailImgError(el);
    expect(el.src).toBe("https://i.ytimg.com/vi/x/default.jpg");
    applyVideoThumbnailImgError(el);
    expect(el.dataset.fallbackSteps).toBe("4");
  });
});
