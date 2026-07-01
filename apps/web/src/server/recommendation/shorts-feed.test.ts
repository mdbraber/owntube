import { describe, expect, it, vi } from "vitest";
import { shortsSeen as shortsSeenTable, users } from "@/server/db/schema";
import {
  buildShortsExclusionSet,
  fetchShortsFeedForViewer,
  parseShortsRecPage,
  shortsContinuationForcesPoolRefresh,
} from "@/server/recommendation/shorts-feed";
import * as shortsPool from "@/server/recommendation/shorts-recommendation-pool";
import * as shortsSeen from "@/server/recommendation/shorts-seen";
import * as watchedVideos from "@/server/recommendation/watched-videos";
import * as proxy from "@/server/services/proxy";
import { createTestDb } from "@/test/db";

describe("parseShortsRecPage", () => {
  it("returns null for first page", () => {
    expect(parseShortsRecPage(undefined)).toBeNull();
    expect(parseShortsRecPage("piped:search")).toBeNull();
  });

  it("parses recommendation pagination", () => {
    expect(parseShortsRecPage("rec:2")).toBe(2);
    expect(parseShortsRecPage("rec:5")).toBe(5);
    expect(parseShortsRecPage("rec:refresh")).toBe(1);
  });

  it("detects pool refresh continuation", () => {
    expect(shortsContinuationForcesPoolRefresh("rec:refresh")).toBe(true);
    expect(shortsContinuationForcesPoolRefresh("rec:2")).toBe(false);
  });
});

describe("buildShortsExclusionSet", () => {
  it("includes client session excludes for anonymous viewers", () => {
    const set = buildShortsExclusionSet(
      null as unknown as import("@/server/db/client").AppDb,
      null,
      ["abcdefghijk", "sessionOnly12"],
    );
    expect(set?.has("abcdefghijk")).toBe(true);
    expect(set?.has("sessionOnly12")).toBe(true);
  });

  it("merges client excludes with DB watch history for signed-in viewers", () => {
    vi.spyOn(
      watchedVideos,
      "loadWatchedVideoIdsForRecommendations",
    ).mockReturnValue(new Set(["watchedInDb1"]));
    vi.spyOn(shortsSeen, "loadShortSeenVideoIds").mockReturnValue(
      new Set(["shortSeen1"]),
    );

    const set = buildShortsExclusionSet(
      null as unknown as import("@/server/db/client").AppDb,
      1,
      ["sessionScroll1", "watchedInDb1"],
    );
    expect(set?.has("watchedInDb1")).toBe(true);
    expect(set?.has("shortSeen1")).toBe(true);
    expect(set?.has("sessionScroll1")).toBe(true);
    expect(set?.size).toBe(3);

    vi.restoreAllMocks();
  });

  it("excludes recently seen shorts but lets old ones recycle", () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const userId = db
      .insert(users)
      .values({
        email: "shorts-window@test.local",
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get().id;
    db.insert(shortsSeenTable)
      .values([
        {
          userId,
          videoId: "seenLastWk1",
          channelId: "ch1",
          seenAt: now - 7 * 24 * 3600,
        },
        {
          userId,
          videoId: "seenAges001",
          channelId: "ch1",
          seenAt: now - 200 * 24 * 3600,
        },
      ])
      .run();

    const set = buildShortsExclusionSet(db, userId, []);
    expect(set?.has("seenLastWk1")).toBe(true);
    expect(set?.has("seenAges001")).toBe(false);
    sqlite.close();
  });
});

describe("fetchShortsFeedForViewer generic recycle", () => {
  it("returns a recycle cursor when upstream runs out but shorts were found", async () => {
    vi.spyOn(proxy, "fetchShortsFeed").mockResolvedValue({
      videos: [
        {
          videoId: "genericShort1",
          title: "Generic short",
          channelId: "ch1",
          channelName: "Channel",
          durationSeconds: 30,
        },
      ],
      continuation: undefined,
      sourceUsed: "piped" as const,
    });

    const result = await fetchShortsFeedForViewer(
      null as unknown as import("@/server/db/client").AppDb,
      null,
      { region: "FR", limit: 24 },
    );

    expect(result.videos).toHaveLength(1);
    expect(result.continuation).toBe("shorts:refresh");

    vi.restoreAllMocks();
  });

  it("stops (no cursor) when a recycle pass yields nothing new", async () => {
    vi.spyOn(proxy, "fetchShortsFeed").mockResolvedValue({
      videos: [],
      continuation: undefined,
      sourceUsed: "piped" as const,
    });

    const result = await fetchShortsFeedForViewer(
      null as unknown as import("@/server/db/client").AppDb,
      null,
      { region: "FR", limit: 24, continuation: "shorts:refresh" },
    );

    expect(result.videos).toHaveLength(0);
    expect(result.continuation).toBeUndefined();

    vi.restoreAllMocks();
  });
});

describe("fetchShortsFeedForViewer shelf purpose", () => {
  it("tops up a starved shelf with already-seen shorts instead of a near-empty row", async () => {
    vi.spyOn(
      watchedVideos,
      "loadWatchedVideoIdsForRecommendations",
    ).mockReturnValue(new Set(["watchedShort1", "watchedShort2"]));
    vi.spyOn(shortsSeen, "loadShortSeenVideoIds").mockReturnValue(new Set());
    vi.spyOn(shortsPool, "getShortsRecommendations").mockResolvedValue({
      videos: [],
      coldStart: false,
      hasMore: false,
    });
    const upstream = [
      {
        videoId: "watchedShort1",
        title: "Seen before",
        channelId: "ch1",
        channelName: "Channel",
        durationSeconds: 30,
      },
      {
        videoId: "watchedShort2",
        title: "Also seen",
        channelId: "ch2",
        channelName: "Channel 2",
        durationSeconds: 25,
      },
      {
        videoId: "freshShort01",
        title: "Fresh one",
        channelId: "ch3",
        channelName: "Channel 3",
        durationSeconds: 20,
      },
    ];
    vi.spyOn(proxy, "fetchShortsFeed").mockResolvedValue({
      videos: upstream,
      continuation: undefined,
      sourceUsed: "piped" as const,
    });

    const result = await fetchShortsFeedForViewer(
      null as unknown as import("@/server/db/client").AppDb,
      7,
      { region: "FR", limit: 3, purpose: "shelf" },
    );

    // Fresh short first, then watched ones re-surfaced to fill the row.
    expect(result.videos.map((v) => v.videoId)).toEqual([
      "freshShort01",
      "watchedShort1",
      "watchedShort2",
    ]);

    vi.restoreAllMocks();
  });

  it("uses a single upstream fetch when the personalized pool is cold", async () => {
    vi.spyOn(shortsPool, "getShortsRecommendations").mockResolvedValue({
      videos: [],
      coldStart: false,
      hasMore: false,
    });
    const fetchShortsFeed = vi
      .spyOn(proxy, "fetchShortsFeed")
      .mockResolvedValue({
        videos: [
          {
            videoId: "shortShelf001",
            title: "Shelf short",
            channelId: "ch1",
            channelName: "Channel",
            durationSeconds: 42,
          },
        ],
        sourceUsed: "piped" as const,
      });

    const result = await fetchShortsFeedForViewer(
      null as unknown as import("@/server/db/client").AppDb,
      null,
      { region: "FR", limit: 14, purpose: "shelf" },
    );

    expect(fetchShortsFeed).toHaveBeenCalledTimes(1);
    expect(result.videos).toHaveLength(1);
    expect(result.videos[0]?.videoId).toBe("shortShelf001");

    vi.restoreAllMocks();
  });
});
