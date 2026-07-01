import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users, watchHistory } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("historyRouter", () => {
  it("writes and lists history entries", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "history@example.com",
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();

    const caller = appRouter.createCaller({ db, userId: user.id });
    await caller.history.upsertEvent({
      videoId: "dQw4w9WgXcQ",
      channelId: "UC1",
      durationWatched: 42,
      completed: false,
    });
    const rows = await caller.history.list({ page: 1, pageSize: 20 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.videoId).toBe("dQw4w9WgXcQ");
    sqlite.close();
  });

  it("stores videoDurationSeconds and max-merges it on the recent-watch path", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "history-duration@example.com",
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();

    const caller = appRouter.createCaller({ db, userId: user.id });
    const first = await caller.history.upsertEvent({
      videoId: "dQw4w9WgXcQ",
      channelId: "UC1",
      durationWatched: 10,
      completed: false,
      videoDurationSeconds: 600,
    });
    // Same video within 30 min merges into the existing row; duration stays the max.
    const second = await caller.history.upsertEvent({
      videoId: "dQw4w9WgXcQ",
      channelId: "UC1",
      durationWatched: 30,
      completed: false,
      videoDurationSeconds: 0,
    });
    expect(second).toEqual({ id: first.id, updated: true });

    const row = db
      .select()
      .from(watchHistory)
      .where(eq(watchHistory.id, first.id))
      .get();
    expect(row?.durationWatched).toBe(30);
    expect(row?.videoDurationSeconds).toBe(600);
    expect(row?.completed).toBe(0);
    sqlite.close();
  });
});
