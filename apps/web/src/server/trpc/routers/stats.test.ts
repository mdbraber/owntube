import { describe, expect, it } from "vitest";
import { users, watchHistory } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("statsRouter", () => {
  it("returns aggregate dashboard stats", async () => {
    const { db, sqlite } = createTestDb();
    const ts = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "stats@example.com",
        passwordHash: "x",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: users.id })
      .get();
    db.insert(watchHistory)
      .values({
        userId: user.id,
        videoId: "dQw4w9WgXcQ",
        channelId: "UC1",
        startedAt: ts - 1000,
        durationWatched: 120,
        completed: 0,
        isDeleted: 0,
        createdAt: ts - 1000,
      })
      .run();
    const caller = appRouter.createCaller({ db, userId: user.id });
    const stats = await caller.stats.dashboard();
    expect(stats.totalHistory).toBe(1);
    expect(stats.totalWatchSeconds).toBe(120);
    sqlite.close();
  });
});
