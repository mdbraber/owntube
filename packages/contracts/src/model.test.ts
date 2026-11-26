import { describe, expect, it } from "vitest";
import { countSchema, videoDetailSchema, videoSummarySchema } from "./model.ts";

const summary = {
  videoId: "dQw4w9WgXcQ",
  title: "t",
  thumbnails: [],
  live: "none",
  isShort: false,
};

describe("model", () => {
  it("accepts a minimal video summary", () => {
    expect(videoSummarySchema.parse(summary)).toEqual(summary);
  });

  it("rejects unknown live states and negative counts", () => {
    expect(
      videoSummarySchema.safeParse({ ...summary, live: "maybe" }).success,
    ).toBe(false);
    expect(
      countSchema.safeParse({ value: -1, approximate: false }).success,
    ).toBe(false);
  });

  it("requires a detail's own fields", () => {
    expect(videoDetailSchema.safeParse(summary).success).toBe(false);
    const detail = {
      ...summary,
      description: "",
      keywords: [],
      captions: [],
      chapters: [],
      related: [],
      unplayable: null,
    };
    expect(videoDetailSchema.parse(detail)).toEqual(detail);
  });
});
