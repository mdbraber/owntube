import { describe, expect, it } from "vitest";
import {
  interactions,
  playlistItems,
  playlists,
  users,
  watchQueue,
} from "@/server/db/schema";
import { getCollectedVideoIds } from "@/server/recommendation/collected-videos";
import { createTestDb } from "@/test/db";

function seedUser(db: ReturnType<typeof createTestDb>["db"], email: string) {
  const now = Math.floor(Date.now() / 1000);
  return db
    .insert(users)
    .values({ email, passwordHash: "x", createdAt: now, updatedAt: now })
    .returning({ id: users.id })
    .get();
}

describe("getCollectedVideoIds", () => {
  it("collects queue, saved, and playlist videos for the user", () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = seedUser(db, "collected@example.com");

    db.insert(watchQueue)
      .values({
        userId: user.id,
        videoId: "queued1",
        title: "Queued",
        position: 0,
        addedAt: now,
      })
      .run();
    db.insert(interactions)
      .values({
        userId: user.id,
        videoId: "saved1",
        type: "save",
        createdAt: now,
      })
      .run();
    const playlist = db
      .insert(playlists)
      .values({
        userId: user.id,
        name: "Watch later",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: playlists.id })
      .get();
    db.insert(playlistItems)
      .values({ playlistId: playlist.id, videoId: "inplaylist1", addedAt: now })
      .run();

    const collected = getCollectedVideoIds(db, user.id);
    expect(collected).toEqual(new Set(["queued1", "saved1", "inplaylist1"]));
    sqlite.close();
  });

  it("ignores likes/dislikes and other users' collections", () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = seedUser(db, "me@example.com");
    const other = seedUser(db, "other@example.com");

    // A like is a taste signal, not a "collected" video.
    db.insert(interactions)
      .values({
        userId: user.id,
        videoId: "liked1",
        type: "like",
        createdAt: now,
      })
      .run();
    // Another user's queue and playlist must not leak in.
    db.insert(watchQueue)
      .values({
        userId: other.id,
        videoId: "otherqueued",
        title: "Theirs",
        position: 0,
        addedAt: now,
      })
      .run();
    const otherPlaylist = db
      .insert(playlists)
      .values({
        userId: other.id,
        name: "Theirs",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: playlists.id })
      .get();
    db.insert(playlistItems)
      .values({
        playlistId: otherPlaylist.id,
        videoId: "otherplaylist",
        addedAt: now,
      })
      .run();

    expect(getCollectedVideoIds(db, user.id).size).toBe(0);
    sqlite.close();
  });
});
