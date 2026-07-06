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

  it("prefers the exact position over dwell, and a mount-time 0 does not wipe it", async () => {
    const { db, sqlite } = createTestDb();
    const userId = seedUser(db, "resume-position@example.com");
    const caller = appRouter.createCaller({ db, userId });
    // Real position (200) diverges from dwell (150) — e.g. user seeked forward.
    await caller.history.upsertEvent({
      videoId: "seekedVid00",
      channelId: "UC1",
      durationWatched: 150,
      positionSeconds: 200,
      completed: false,
      videoDurationSeconds: 600,
    });
    expect(getWatchResumeSeconds(db, userId, "seekedVid00")).toBe(200);

    // Reopening fires a mount event with no position; the saved 200 must remain.
    await caller.history.upsertEvent({
      videoId: "seekedVid00",
      channelId: "UC1",
      durationWatched: 0,
      completed: false,
      videoDurationSeconds: 600,
    });
    expect(getWatchResumeSeconds(db, userId, "seekedVid00")).toBe(200);
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
