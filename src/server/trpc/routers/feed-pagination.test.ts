import { describe, expect, it } from "vitest";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import {
  mergePersonalizedWithTrendingTail,
  resolveHomeFeedSkip,
  sliceHomeFeedStream,
} from "@/server/trpc/routers/feed";

function v(id: string): UnifiedVideo {
  return {
    videoId: id,
    title: id,
    channelId: "ch",
    channelName: "Ch",
    durationSeconds: 60,
    viewCount: 1,
    thumbnailUrl: "",
  };
}

describe("home feed pagination", () => {
  it("resolveHomeFeedSkip uses cursor offset", () => {
    expect(resolveHomeFeedSkip({ cursor: 24, page: 1, pageSize: 24 }, 24)).toBe(
      24,
    );
    expect(resolveHomeFeedSkip({ page: 2, pageSize: 24 }, 24)).toBe(24);
    expect(resolveHomeFeedSkip(undefined, 24)).toBe(0);
  });

  it("mergePersonalizedWithTrendingTail drops tail duplicates", () => {
    const stream = mergePersonalizedWithTrendingTail(
      [v("a"), v("b")],
      [v("b"), v("c")],
    );
    expect(stream.map((x) => x.videoId)).toEqual(["a", "b", "c"]);
  });

  it("sliceHomeFeedStream advances without repeating", () => {
    const stream = [v("1"), v("2"), v("3"), v("4"), v("5")];
    const p1 = sliceHomeFeedStream(stream, 0, 2);
    expect(p1.videos.map((x) => x.videoId)).toEqual(["1", "2"]);
    expect(p1.hasMore).toBe(true);
    const p2 = sliceHomeFeedStream(stream, 2, 2);
    expect(p2.videos.map((x) => x.videoId)).toEqual(["3", "4"]);
    expect(p2.hasMore).toBe(true);
    const p3 = sliceHomeFeedStream(stream, 4, 2);
    expect(p3.videos.map((x) => x.videoId)).toEqual(["5"]);
    expect(p3.hasMore).toBe(false);
  });
});
