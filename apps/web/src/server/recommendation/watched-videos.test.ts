import { describe, expect, it } from "vitest";
import { users, watchHistory } from "@/server/db/schema";
import { loadWatchedVideoIdsForRecommendations } from "@/server/recommendation/watched-videos";
import { createTestDb } from "@/test/db";

describe("loadWatchedVideoIdsForRecommendations", () => {
  it("returns all non-deleted watch history video ids", () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "watched-shorts@example.com",
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();

    db.insert(watchHistory)
      .values({
        userId: user.id,
        videoId: "dQw4w9WgXcQ",
        channelId: "UC1",
        startedAt: now - 400 * 24 * 3600,
        durationWatched: 45,
        completed: 1,
        isDeleted: 0,
        createdAt: now,
      })
      .run();

    const watched = loadWatchedVideoIdsForRecommendations(db, user.id);
    expect(watched.has("dQw4w9WgXcQ")).toBe(true);
    sqlite.close();
  });
});
