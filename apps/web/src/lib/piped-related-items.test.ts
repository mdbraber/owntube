import { describe, expect, it } from "vitest";
import { pipedRelatedListItems } from "./piped-related-items";

describe("pipedRelatedListItems", () => {
  it("reads relatedStreams from Piped /streams/:id payloads", () => {
    const items = pipedRelatedListItems({
      title: "Main video",
      relatedStreams: [{ url: "/watch?v=abc12345678", title: "Related" }],
    });
    expect(items).toHaveLength(1);
  });

  it("falls back to items/results arrays", () => {
    expect(
      pipedRelatedListItems({ items: [{ url: "/watch?v=x" }] }),
    ).toHaveLength(1);
    expect(pipedRelatedListItems([{ url: "/watch?v=y" }])).toHaveLength(1);
  });
});
