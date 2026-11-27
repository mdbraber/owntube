import { describe, expect, it } from "vitest";
import {
  applyVideoThumbnailImgError,
  nextFallbackVideoThumbnailUrl,
  preferHeroVideoThumbnailUrl,
  preferHighResVideoThumbnailUrl,
  preferShortVideoThumbnailUrl,
} from "@/lib/video-thumbnail-url";

const still = (id: string, name: string) => `/media/img/yti/vi/${id}/${name}`;

describe("video-thumbnail-url", () => {
  it("upgrades an unsigned lower still to maxres", () => {
    expect(
      preferHighResVideoThumbnailUrl(still("abc123", "hqdefault.jpg")),
    ).toBe(still("abc123", "maxresdefault.jpg"));
  });

  it("keeps signed stills as they are (the name is tied to the signature)", () => {
    const signed = `${still("abc123", "hq720.jpg")}?sqp=x&rs=y`;
    expect(preferHighResVideoThumbnailUrl(signed)).toBe(signed);
    expect(preferShortVideoThumbnailUrl(signed, "abc123")).toBe(signed);
  });

  it("falls back to hqdefault by id when there is no still", () => {
    expect(preferHighResVideoThumbnailUrl(undefined, "abc123")).toBe(
      still("abc123", "hqdefault.jpg"),
    );
    expect(preferHighResVideoThumbnailUrl(undefined)).toBeUndefined();
  });

  it("uses maxres by id for heroes", () => {
    expect(preferHeroVideoThumbnailUrl(undefined, "abc123")).toBe(
      still("abc123", "maxresdefault.jpg"),
    );
  });

  it("prefers a Short's vertical still", () => {
    expect(
      preferShortVideoThumbnailUrl(still("abc123", "maxresdefault.jpg")),
    ).toBe(still("abc123", "oar2.jpg"));
    expect(preferShortVideoThumbnailUrl(still("abc123", "oar2.jpg"))).toBe(
      still("abc123", "oar2.jpg"),
    );
  });

  it("steps down the chain, signed or not, then stops", () => {
    expect(
      nextFallbackVideoThumbnailUrl(`${still("x", "hq720.jpg")}?sqp=a&rs=b`),
    ).toBe(still("x", "hqdefault.jpg"));
    expect(nextFallbackVideoThumbnailUrl(still("x", "oar2.jpg"))).toBe(
      still("x", "oardefault.jpg"),
    );
    expect(nextFallbackVideoThumbnailUrl(still("x", "default.jpg"))).toBe(
      undefined,
    );
    expect(nextFallbackVideoThumbnailUrl("https://example.com/a.jpg")).toBe(
      undefined,
    );
  });

  it("applyVideoThumbnailImgError steps down a few times at most", () => {
    // Like a real <img>: `src` reads back absolute, on the page's origin.
    let src = `https://owntube.test${still("x", "maxresdefault.jpg")}`;
    const el = {
      get src() {
        return src;
      },
      set src(v: string) {
        src = new URL(v, "https://owntube.test").toString();
      },
      dataset: {} as DOMStringMap,
    } as HTMLImageElement;

    applyVideoThumbnailImgError(el);
    expect(el.src).toBe(`https://owntube.test${still("x", "hqdefault.jpg")}`);
    expect(el.dataset.fallbackSteps).toBe("1");
    applyVideoThumbnailImgError(el);
    applyVideoThumbnailImgError(el);
    applyVideoThumbnailImgError(el);
    expect(el.src).toBe(`https://owntube.test${still("x", "default.jpg")}`);
    applyVideoThumbnailImgError(el);
    expect(el.dataset.fallbackSteps).toBe("4");
  });
});
