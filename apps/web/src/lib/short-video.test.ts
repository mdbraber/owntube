import { describe, expect, it } from "vitest";
import { filterShortsFeedVideos, isStrictShortVideo } from "@/lib/short-video";
import type { UnifiedVideo } from "@/server/catalog/types";

const row = (o: Partial<UnifiedVideo>): UnifiedVideo => ({
  videoId: "dQw4w9WgXcQ",
  title: "A video",
  ...o,
});

describe("isStrictShortVideo", () => {
  it("trusts the row's own flag, whatever its length or title", () => {
    expect(
      isStrictShortVideo(row({ isShort: true, durationSeconds: 170 })),
    ).toBe(true);
    expect(
      isStrictShortVideo(
        row({ isShort: false, durationSeconds: 30, title: "Clip #shorts" }),
      ),
    ).toBe(false);
  });

  it("never calls a live or upcoming row a Short", () => {
    expect(isStrictShortVideo(row({ isShort: true, isLive: true }))).toBe(
      false,
    );
    expect(isStrictShortVideo(row({ isShort: true, isUpcoming: true }))).toBe(
      false,
    );
  });

  it("falls back to the length for rows without a flag (RSS)", () => {
    expect(isStrictShortVideo(row({ durationSeconds: 45 }))).toBe(true);
    expect(isStrictShortVideo(row({ durationSeconds: 600 }))).toBe(false);
    expect(
      isStrictShortVideo(row({ durationSeconds: 600, title: "x #shorts" })),
    ).toBe(false);
  });

  it("falls back to #shorts in the title when nothing else is known", () => {
    expect(isStrictShortVideo(row({ title: "Clip #Shorts" }))).toBe(true);
    expect(
      isStrictShortVideo(row({ durationSeconds: -1, title: "Clip" })),
    ).toBe(false);
  });
});

describe("filterShortsFeedVideos", () => {
  it("keeps only Shorts", () => {
    expect(
      filterShortsFeedVideos([
        row({ videoId: "a", isShort: true }),
        row({ videoId: "b", isShort: false }),
      ]).map((v) => v.videoId),
    ).toEqual(["a"]);
  });
});
