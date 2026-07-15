import { describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

function setup() {
  const { db, sqlite } = createTestDb();
  const now = Math.floor(Date.now() / 1000);
  const user = db
    .insert(users)
    .values({
      email: `queue-${now}-${Math.random()}@example.com`,
      passwordHash: "x",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id })
    .get();
  return {
    db,
    sqlite,
    caller: appRouter.createCaller({ db, userId: user.id }),
  };
}

describe("watch queue: watching a video removes it", () => {
  it("drops the video from the queue when a watch completes", async () => {
    const { sqlite, caller } = setup();
    await caller.queue.add({
      videoId: "vid-done",
      title: "Done",
      channelId: "UC1",
    });
    await caller.queue.add({
      videoId: "vid-next",
      title: "Next",
      channelId: "UC1",
    });

    const res = await caller.history.upsertEvent({
      videoId: "vid-done",
      channelId: "UC1",
      durationWatched: 600,
      completed: true,
    });

    expect(res.dequeued).toBe(true);
    expect((await caller.queue.list()).map((i) => i.videoId)).toEqual([
      "vid-next",
    ]);
    sqlite.close();
  });

  it("keeps a video that is only partly watched", async () => {
    const { sqlite, caller } = setup();
    await caller.queue.add({ videoId: "vid-partial", title: "Partial" });

    const res = await caller.history.upsertEvent({
      videoId: "vid-partial",
      channelId: "UC1",
      durationWatched: 30,
      positionSeconds: 30,
      completed: false,
    });

    expect(res.dequeued).toBe(false);
    expect((await caller.queue.list()).map((i) => i.videoId)).toEqual([
      "vid-partial",
    ]);
    sqlite.close();
  });

  it("drops the video when it is marked watched by hand", async () => {
    const { sqlite, caller } = setup();
    await caller.queue.add({ videoId: "vid-marked", title: "Marked" });

    await caller.subscriptions.markWatched({
      videoId: "vid-marked",
      channelId: "UC1",
    });

    expect(await caller.queue.list()).toEqual([]);
    sqlite.close();
  });

  it("leaves a re-queued video alone until the re-watch finishes", async () => {
    const { sqlite, caller } = setup();
    await caller.history.upsertEvent({
      videoId: "vid-again",
      channelId: "UC1",
      durationWatched: 600,
      completed: true,
    });
    // Deliberately queued for a second viewing, after it was already watched.
    await caller.queue.add({ videoId: "vid-again", title: "Again" });

    const resume = await caller.history.upsertEvent({
      videoId: "vid-again",
      channelId: "UC1",
      durationWatched: 60,
      positionSeconds: 60,
      completed: false,
    });
    expect(resume.dequeued).toBe(false);
    expect(await caller.queue.list()).toHaveLength(1);

    const finished = await caller.history.upsertEvent({
      videoId: "vid-again",
      channelId: "UC1",
      durationWatched: 600,
      completed: true,
    });
    expect(finished.dequeued).toBe(true);
    expect(await caller.queue.list()).toEqual([]);
    sqlite.close();
  });
});
