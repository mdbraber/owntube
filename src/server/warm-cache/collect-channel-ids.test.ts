import { describe, expect, it } from "vitest";
import {
  collectRecentHistoryChannelIds,
  collectWarmChannelIds,
} from "./collect-channel-ids";

describe("collectRecentHistoryChannelIds", () => {
  it("returns unique channels ordered by most recent watch", () => {
    const rows = [
      { channelId: "UC_b", startedAt: 200 },
      { channelId: "UC_a", startedAt: 150 },
      { channelId: "UC_b", startedAt: 180 },
      { channelId: "UC_a", startedAt: 100 },
      { channelId: "UC_c", startedAt: 50 },
    ];

    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                all: () => rows,
              }),
            }),
          }),
        }),
      }),
    };

    expect(collectRecentHistoryChannelIds(db as never, 2)).toEqual([
      "UC_b",
      "UC_a",
    ]);
  });

  it("returns empty list when limit is zero", () => {
    const db = { select: () => ({ from: () => ({}) }) };
    expect(collectRecentHistoryChannelIds(db as never, 0)).toEqual([]);
  });
});

describe("collectWarmChannelIds", () => {
  it("deduplicates subscriptions before history channels", () => {
    const subscriptionIds = ["UC_sub_a", "UC_sub_b"];
    const historyIds = ["UC_sub_b", "UC_hist"];

    const db = {
      selectDistinct: () => ({
        from: () => ({
          all: () => subscriptionIds.map((channelId) => ({ channelId })),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                all: () =>
                  historyIds.map((channelId, index) => ({
                    channelId,
                    startedAt: 1000 - index,
                  })),
              }),
            }),
          }),
        }),
      }),
    };

    expect(collectWarmChannelIds(db as never, 8)).toEqual([
      "UC_sub_a",
      "UC_sub_b",
      "UC_hist",
    ]);
  });
});
