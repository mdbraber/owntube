import { describe, expect, it } from "vitest";
import {
  blockFeedFilter,
  type HomeBlock,
  homeBlockHref,
  homeBlockTitle,
} from "@/lib/home-blocks";

function block(patch: Partial<HomeBlock>): HomeBlock {
  return {
    id: "b",
    type: "subscriptions",
    limit: 8,
    rows: 2,
    layout: "cards",
    size: "md",
    ...patch,
  };
}

describe("home block feeds", () => {
  it("favorites resolve on the server", () => {
    const fav = block({ type: "favorites" });
    expect(blockFeedFilter(fav)).toEqual({ favorites: true });
    expect(homeBlockTitle(fav)).toBe("Favorites");
    expect(homeBlockHref(fav)).toBe("/favorites");
  });

  it("tag blocks carry their bundle and match mode", () => {
    const tag = block({
      type: "tag",
      options: { "tag:music": true, "tag:live": true, "tag:news": false },
    });
    expect(blockFeedFilter(tag)).toEqual({
      includeTags: ["music", "live"],
      excludeTags: ["news"],
      tagMatch: "any",
    });
    expect(homeBlockTitle(tag)).toBe("#music · #live");

    const all = block({ ...tag, options: { ...tag.options, matchAll: true } });
    expect(blockFeedFilter(all).tagMatch).toBe("all");
    expect(homeBlockTitle(all)).toBe("#music + #live");
    expect(homeBlockHref(all)).toBe(
      "/tags?tag=music&tag=live&not=news&match=all",
    );
    expect(homeBlockTitle({ ...all, title: " Gigs " })).toBe("Gigs");
  });

  it("subscription blocks keep their any-tag filter", () => {
    expect(blockFeedFilter(block({ options: { "tag:music": true } }))).toEqual({
      includeTags: ["music"],
      excludeTags: undefined,
    });
  });
});
