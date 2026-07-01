import { describe, expect, it } from "vitest";
import { prepareShortsFeedVideos } from "@/lib/shorts-feed-presentation";
import type { UnifiedVideo } from "@/server/services/proxy.types";

function video(videoId: string, channelId?: string): UnifiedVideo {
  return { videoId, title: videoId, channelId } as UnifiedVideo;
}

describe("prepareShortsFeedVideos", () => {
  it("interleaves channels and respects limit", () => {
    const result = prepareShortsFeedVideos(
      [
        video("a1", "A"),
        video("a2", "A"),
        video("a3", "A"),
        video("b1", "B"),
        video("c1", "C"),
      ],
      3,
    );
    expect(result.map((v) => v.videoId)).toEqual(["a1", "b1", "c1"]);
  });
});
