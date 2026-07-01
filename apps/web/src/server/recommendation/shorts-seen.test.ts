import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { shortsSeen, users } from "@/server/db/schema";
import {
  loadShortSeenVideoIds,
  loadSoftSeenShortVideoIds,
  recordShortSeen,
  SHORTS_SEEN_HARD_WINDOW_SEC,
} from "@/server/recommendation/shorts-seen";
import { createTestDb } from "@/test/db";

function createUser(db: ReturnType<typeof createTestDb>["db"]): number {
  const ts = Math.floor(Date.now() / 1000);
  return db
    .insert(users)
    .values({
      email: `shorts-seen-${Math.random().toString(36).slice(2)}@test.local`,
      passwordHash: "x",
      createdAt: ts,
      updatedAt: ts,
    })
    .returning({ id: users.id })
    .get().id;
}

describe("shorts-seen", () => {
  it("records and loads seen shorts", () => {
    const { db, sqlite } = createTestDb();
    const userId = createUser(db);

    recordShortSeen(db, userId, "abcdefghijk", "chan123");
    recordShortSeen(db, userId, "klmnopqrstu", "chan456");

    const seen = loadShortSeenVideoIds(db, userId);
    expect(seen.has("abcdefghijk")).toBe(true);
    expect(seen.has("klmnopqrstu")).toBe(true);
    expect(seen.size).toBe(2);
    sqlite.close();
  });

  it("ages rows out of the hard window into the soft band, then out entirely", () => {
    const { db, sqlite } = createTestDb();
    const userId = createUser(db);
    const now = Math.floor(Date.now() / 1000);

    const insertSeenAt = (videoId: string, seenAt: number) =>
      db
        .insert(shortsSeen)
        .values({ userId, videoId, channelId: "chan1", seenAt })
        .run();
    insertSeenAt("recent00001", now - 10 * 24 * 3600);
    insertSeenAt("softband001", now - 60 * 24 * 3600);
    insertSeenAt("ancient0001", now - 120 * 24 * 3600);

    const hard = loadShortSeenVideoIds(db, userId);
    expect(hard.has("recent00001")).toBe(true);
    expect(hard.has("softband001")).toBe(false);
    expect(hard.has("ancient0001")).toBe(false);

    const soft = loadSoftSeenShortVideoIds(db, userId);
    expect(soft.has("softband001")).toBe(true);
    expect(soft.has("recent00001")).toBe(false);
    expect(soft.has("ancient0001")).toBe(false);
    sqlite.close();
  });

  it("re-seeing a short refreshes seenAt back into the hard window", () => {
    const { db, sqlite } = createTestDb();
    const userId = createUser(db);
    const now = Math.floor(Date.now() / 1000);

    db.insert(shortsSeen)
      .values({
        userId,
        videoId: "resurfaced1",
        channelId: "chan1",
        seenAt: now - SHORTS_SEEN_HARD_WINDOW_SEC - 24 * 3600,
      })
      .run();
    expect(loadShortSeenVideoIds(db, userId).has("resurfaced1")).toBe(false);

    recordShortSeen(db, userId, "resurfaced1", "chan1");
    expect(loadShortSeenVideoIds(db, userId).has("resurfaced1")).toBe(true);
    const row = db
      .select({ seenAt: shortsSeen.seenAt })
      .from(shortsSeen)
      .where(eq(shortsSeen.userId, userId))
      .all();
    expect(row).toHaveLength(1);
    expect(row[0]?.seenAt).toBeGreaterThanOrEqual(now);
    sqlite.close();
  });
});
