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

  it("stores denormalized titles and matches them in search", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "history-search@example.com",
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
      videoTitle: "Never Gonna Give You Up",
      channelName: "Rick Astley",
    });

    const byTitle = await caller.history.list({
      page: 1,
      pageSize: 20,
      q: "gonna give",
    });
    expect(byTitle).toHaveLength(1);
    expect(byTitle[0]?.videoTitle).toBe("Never Gonna Give You Up");
    expect(byTitle[0]?.channelName).toBe("Rick Astley");

    const byChannel = await caller.history.list({
      page: 1,
      pageSize: 20,
      q: "astley",
    });
    expect(byChannel).toHaveLength(1);

    const noMatch = await caller.history.list({
      page: 1,
      pageSize: 20,
      q: "unrelated query",
    });
    expect(noMatch).toHaveLength(0);
    sqlite.close();
  });

  it("keeps a single row per video and moves it up on re-watch", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "history-dedupe@example.com",
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
      durationWatched: 20,
      completed: false,
      videoDurationSeconds: 600,
    });
    // A second watch far later still folds into the same row (no duplicate).
    const second = await caller.history.upsertEvent({
      videoId: "dQw4w9WgXcQ",
      channelId: "UC1",
      durationWatched: 120,
      completed: false,
      videoDurationSeconds: 600,
    });
    expect(second).toEqual({ id: first.id, updated: true });

    const activeRows = db
      .select()
      .from(watchHistory)
      .where(eq(watchHistory.userId, user.id))
      .all()
      .filter((r) => r.isDeleted === 0);
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]?.durationWatched).toBe(120);

    const listed = await caller.history.list({ page: 1, pageSize: 20 });
    expect(listed).toHaveLength(1);
    sqlite.close();
  });

  it("hideWatched excludes completed videos and exposes progress fields", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "history-hide@example.com",
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();

    const caller = appRouter.createCaller({ db, userId: user.id });
    await caller.history.upsertEvent({
      videoId: "partialVid0",
      channelId: "UC1",
      durationWatched: 100,
      completed: false,
      videoDurationSeconds: 600,
      videoTitle: "Half Watched",
      channelName: "Chan",
    });
    await caller.history.upsertEvent({
      videoId: "doneVideo00",
      channelId: "UC1",
      durationWatched: 590,
      completed: true,
      videoDurationSeconds: 600,
      videoTitle: "Finished",
      channelName: "Chan",
    });

    const all = await caller.history.list({ page: 1, pageSize: 20 });
    expect(all).toHaveLength(2);
    const partial = all.find((r) => r.videoId === "partialVid0");
    expect(partial?.videoDurationSeconds).toBe(600);
    expect(partial?.durationWatched).toBe(100);

    const unwatched = await caller.history.list({
      page: 1,
      pageSize: 20,
      hideWatched: true,
    });
    expect(unwatched).toHaveLength(1);
    expect(unwatched[0]?.videoId).toBe("partialVid0");
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
