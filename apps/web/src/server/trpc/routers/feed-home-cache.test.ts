import { afterEach, describe, expect, it, vi } from "vitest";
import { interactions, users, videoCache } from "@/server/db/schema";
import * as engine from "@/server/recommendation/engine";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("feed.home materialized stream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers from an expired row while it recomputes in the background", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "home@example.com",
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();
    db.insert(videoCache)
      .values({
        cacheKey: `home-feed:v1:${user.id}:US:1`,
        source: "owntube",
        kind: "home",
        payloadJson: JSON.stringify([
          { videoId: "abcdefghijk", title: "Cached pick" },
        ]),
        fetchedAt: now - 1200,
        expiresAt: now - 600,
      })
      .run();
    // The recompute never finishes; the answer must not wait for it.
    const recompute = vi
      .spyOn(engine, "getPersonalizedFeedVideos")
      .mockReturnValue(new Promise(() => {}));

    const caller = appRouter.createCaller({ db, userId: user.id });
    const page = await caller.feed.home({ region: "US", pageSize: 24 });

    expect(page.videos.map((v) => v.videoId)).toEqual(["abcdefghijk"]);
    expect(recompute).toHaveBeenCalledTimes(1);

    // A second load joins the running refresh instead of starting another.
    await caller.feed.home({ region: "US", pageSize: 24 });
    expect(recompute).toHaveBeenCalledTimes(1);
    sqlite.close();
  });

  it("drops channels blocked and videos rejected after the row was written", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "exclusions@example.com",
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();
    db.insert(videoCache)
      .values({
        cacheKey: `home-feed:v1:${user.id}:US:1`,
        source: "owntube",
        kind: "home",
        payloadJson: JSON.stringify([
          { videoId: "keepkeep001", title: "Keep", channelId: "UCok" },
          { videoId: "blocked0001", title: "Blocked", channelId: "UCblocked" },
          { videoId: "ignored0001", title: "Ignored", channelId: "UCok" },
          { videoId: "disliked001", title: "Disliked", channelId: "UCok" },
          { videoId: "liked000001", title: "Liked", channelId: "UCok" },
        ]),
        fetchedAt: now,
        expiresAt: now + 600,
      })
      .run();
    const caller = appRouter.createCaller({ db, userId: user.id });
    await caller.interactions.blockRecommendationChannel({
      channelId: "UCblocked",
    });
    for (const [videoId, type] of [
      ["ignored0001", "ignore"],
      ["disliked001", "dislike"],
      ["liked000001", "like"],
    ] as const) {
      db.insert(interactions)
        .values({ userId: user.id, videoId, type, createdAt: now })
        .run();
    }
    const recompute = vi.spyOn(engine, "getPersonalizedFeedVideos");

    const page = await caller.feed.home({ region: "US", pageSize: 24 });

    expect(page.videos.map((v) => v.videoId)).toEqual([
      "keepkeep001",
      "liked000001",
    ]);
    expect(recompute).not.toHaveBeenCalled();
    sqlite.close();
  });
});
