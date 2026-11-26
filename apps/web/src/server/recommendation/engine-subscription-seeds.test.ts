import { describe, expect, it } from "vitest";
import type { UnifiedVideo } from "@/server/catalog/types";
import { subscriptionRelatedSeeds } from "@/server/recommendation/engine";

const NOW = 2_000_000_000;

function v(
  videoId: string,
  channelId: string,
  ageDays: number,
  extra: Partial<UnifiedVideo> = {},
): UnifiedVideo {
  return {
    videoId,
    title: videoId,
    channelId,
    channelName: `name-${channelId}`,
    durationSeconds: 600,
    publishedAt: NOW - ageDays * 86_400,
    ...extra,
  };
}

describe("subscriptionRelatedSeeds", () => {
  it("takes the newest long-form upload per subscribed channel, newest first", () => {
    const seeds = subscriptionRelatedSeeds(
      [
        { video: v("a-old", "A", 10), source: "subscription:A" },
        { video: v("a-new", "A", 2), source: "subscription:A" },
        { video: v("b-new", "B", 1), source: "subscription:B" },
        {
          video: v("b-short", "B", 0, { durationSeconds: 30 }),
          source: "subscription:B",
        },
        { video: v("h", "H", 0), source: "history_channel:H" },
        { video: v("c-ancient", "C", 800), source: "subscription:C" },
        { video: v("d-disliked", "D", 1), source: "subscription:D" },
        { video: v("e-blocked", "E", 1), source: "subscription:E" },
      ],
      {
        nowSec: NOW,
        excludeSeedIds: new Set(["d-disliked"]),
        blockedChannelIds: new Set(["E"]),
      },
    );
    expect(seeds).toEqual([
      { videoId: "b-new", channelName: "name-B" },
      { videoId: "a-new", channelName: "name-A" },
    ]);
  });
});
