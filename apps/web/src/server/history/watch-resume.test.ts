import { describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { getWatchResumeSeconds } from "@/server/history/watch-resume";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

function seedUser(db: ReturnType<typeof createTestDb>["db"], email: string) {
  const now = Math.floor(Date.now() / 1000);
  return db
    .insert(users)
    .values({ email, passwordHash: "x", createdAt: now, updatedAt: now })
    .returning({ id: users.id })
    .get().id;
}

describe("getWatchResumeSeconds", () => {
  it("resumes a partially-watched video at the recorded position", async () => {
    const { db, sqlite } = createTestDb();
    const userId = seedUser(db, "resume-partial@example.com");
    const caller = appRouter.createCaller({ db, userId });
    await caller.history.upsertEvent({
      videoId: "partialVid0",
      channelId: "UC1",
      durationWatched: 120,
      completed: false,
      videoDurationSeconds: 600,
    });
    expect(getWatchResumeSeconds(db, userId, "partialVid0")).toBe(120);
    sqlite.close();
  });

  it("returns null for unwatched, completed, barely-started, or near-finished", async () => {
    const { db, sqlite } = createTestDb();
    const userId = seedUser(db, "resume-null@example.com");
    const caller = appRouter.createCaller({ db, userId });

    // never watched
    expect(getWatchResumeSeconds(db, userId, "neverVideo0")).toBeNull();

    await caller.history.upsertEvent({
      videoId: "doneVideo00",
      channelId: "UC1",
      durationWatched: 590,
      completed: true,
      videoDurationSeconds: 600,
    });
    expect(getWatchResumeSeconds(db, userId, "doneVideo00")).toBeNull();

    await caller.history.upsertEvent({
      videoId: "glanceVid00",
      channelId: "UC1",
      durationWatched: 5,
      completed: false,
      videoDurationSeconds: 600,
    });
    expect(getWatchResumeSeconds(db, userId, "glanceVid00")).toBeNull();

    await caller.history.upsertEvent({
      videoId: "almostDone0",
      channelId: "UC1",
      durationWatched: 585,
      completed: false,
      videoDurationSeconds: 600,
    });
    expect(getWatchResumeSeconds(db, userId, "almostDone0")).toBeNull();
    sqlite.close();
  });
});
