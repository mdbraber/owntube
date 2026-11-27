import { describe, expect, it } from "vitest";
import { writeCache } from "@/server/cache/video-cache";
import type { UnifiedVideo } from "@/server/catalog/types";
import { playlists, subscriptions, users } from "@/server/db/schema";
import {
  buildAllFeeds,
  createVideoFactsResolver,
} from "@/server/remote/publish";
import { createTestDb } from "@/test/db";

const CHANNEL = "UCabcdefghijklmnopqrstuv";

function rssEntry(videoId: string, publishedAt: number) {
  return {
    videoId,
    title: `Video ${videoId}`,
    channelId: CHANNEL,
    channelName: "Chan",
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    publishedAt,
  };
}

const video = (videoId: string, durationSeconds: number, isShort = false) =>
  ({
    videoId,
    title: videoId,
    durationSeconds,
    ...(isShort ? { isShort } : {}),
  }) satisfies UnifiedVideo;

describe("createVideoFactsResolver", () => {
  it("prefers the cached channel page, then a cached summary, then one live lookup per video", async () => {
    const live: string[] = [];
    const factsOf = createVideoFactsResolver({
      liveLookups: 1,
      channelVideos: async () => [video("fromPage", 600)],
      summary: async (videoId, cacheOnly) => {
        if (cacheOnly)
          return videoId === "fromSummary"
            ? video(videoId, 45, true)
            : undefined;
        live.push(videoId);
        return video(videoId, 300);
      },
    });

    expect(await factsOf(CHANNEL, "fromPage")).toEqual({
      durationSeconds: 600,
    });
    expect(await factsOf(CHANNEL, "fromSummary")).toEqual({
      durationSeconds: 45,
      isShort: true,
    });
    expect(await factsOf(CHANNEL, "live")).toEqual({ durationSeconds: 300 });
    expect(await factsOf(CHANNEL, "live")).toEqual({ durationSeconds: 300 });
    // Budget spent: the next unknown video goes out without a duration.
    expect(await factsOf(CHANNEL, "overBudget")).toEqual({});
    expect(live).toEqual(["live"]);
  });

  it("treats failed lookups as unknown", async () => {
    const factsOf = createVideoFactsResolver({
      channelVideos: async () => {
        throw new Error("gateway down");
      },
      summary: async () => {
        throw new Error("region blocked");
      },
    });
    expect(await factsOf(CHANNEL, "blocked")).toEqual({});
  });
});

describe("buildAllFeeds channel items", () => {
  it("carries durations and leaves out Shorts", async () => {
    const { db } = createTestDb();
    const user = db
      .insert(users)
      .values({
        email: "a@example.com",
        passwordHash: "x",
        createdAt: 0,
        updatedAt: 0,
      })
      .returning()
      .get();
    db.insert(subscriptions)
      .values({ userId: user.id, channelId: CHANNEL, subscribedAt: 0 })
      .run();
    writeCache(
      db,
      `rss:v1:${CHANNEL}`,
      "youtube",
      {
        entries: [
          rssEntry("shortInWindow", 1_100),
          rssEntry("longInWindow", 1_000),
          rssEntry("shortBeforeWindow", 500),
          rssEntry("longBeforeWindow", 400),
        ],
      },
      "rss",
    );
    writeCache(
      db,
      `rss-uulf:v1:${CHANNEL}`,
      "youtube",
      {
        ids: ["longInWindow"],
        oldestPublishedAt: 900,
        newestPublishedAt: 1_000,
      },
      "rss",
    );
    const factsOf = createVideoFactsResolver({
      channelVideos: async () => [
        video("longInWindow", 600),
        video("shortBeforeWindow", 45),
      ],
      summary: async (videoId) =>
        videoId === "longBeforeWindow" ? video(videoId, 1_200) : undefined,
    });

    const { feeds } = await buildAllFeeds(db, {
      appOrigin: "http://x",
      factsOf,
    });
    for (const kind of ["channel", "subscriptions"]) {
      const feed = feeds.find((f) => f.kind === kind);
      expect(feed?.items.map((i) => [i.videoId, i.durationSeconds])).toEqual([
        ["longInWindow", 600],
        ["longBeforeWindow", 1_200],
      ]);
      // Enclosures are the gateway's signed whole-file URLs.
      expect(feed?.items[0]?.enclosureAudio).toMatch(
        /^http:\/\/x\/media\/v\/longInWindow\/audio\.m4a\?exp=\d+&sig=/,
      );
    }
  });
});

describe("buildAllFeeds empty lists", () => {
  it("still publishes an empty playlist, queue and saved inbox", async () => {
    const { db } = createTestDb();
    const user = db
      .insert(users)
      .values({
        email: "a@example.com",
        passwordHash: "x",
        createdAt: 0,
        updatedAt: 0,
      })
      .returning()
      .get();
    db.insert(playlists)
      .values({ userId: user.id, name: "Later", createdAt: 0, updatedAt: 0 })
      .run();

    const { feeds } = await buildAllFeeds(db, { appOrigin: "http://x" });
    const byKind = Object.fromEntries(feeds.map((f) => [f.kind, f]));
    for (const kind of ["playlist", "queue", "saved"]) {
      expect(byKind[kind]?.items).toEqual([]);
    }
    expect(byKind.playlist?.slug).toBe("later");
  });
});
