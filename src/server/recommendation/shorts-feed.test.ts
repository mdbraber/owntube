import { describe, expect, it, vi } from "vitest";
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
});

describe("fetchShortsFeedForViewer shelf purpose", () => {
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
