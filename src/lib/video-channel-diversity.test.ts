import { describe, expect, it } from "vitest";
import { diversifyVideosByChannel } from "@/lib/video-channel-diversity";
import type { UnifiedVideo } from "@/server/services/proxy.types";

function video(videoId: string, channelId?: string): UnifiedVideo {
  return { videoId, title: videoId, channelId } as UnifiedVideo;
}

describe("diversifyVideosByChannel", () => {
  it("interleaves channels instead of clustering", () => {
    const result = diversifyVideosByChannel(
      [
        video("a1", "A"),
        video("a2", "A"),
        video("a3", "A"),
        video("b1", "B"),
        video("c1", "C"),
      ],
      2,
    );
    expect(result.map((v) => v.videoId)).toEqual(["a1", "b1", "c1", "a2"]);
  });

  it("caps the number of items per channel", () => {
    const result = diversifyVideosByChannel(
      [video("a1", "A"), video("a2", "A"), video("a3", "A"), video("a4", "A")],
      2,
    );
    expect(result.map((v) => v.videoId)).toEqual(["a1", "a2"]);
  });

  it("keeps videos without a channel id as distinct entries", () => {
    const result = diversifyVideosByChannel(
      [video("x1"), video("x2"), video("a1", "A")],
      1,
    );
    expect(result.map((v) => v.videoId).sort()).toEqual(["a1", "x1", "x2"]);
  });

  it("returns empty when maxPerChannel is below 1", () => {
    expect(diversifyVideosByChannel([video("a1", "A")], 0)).toEqual([]);
  });
});
