import { describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("playlistsRouter", () => {
  it("creates playlist and adds an item", async () => {
    const { db, sqlite } = createTestDb();
    const ts = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "playlist@example.com",
        passwordHash: "x",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: users.id })
      .get();
    const caller = appRouter.createCaller({ db, userId: user.id });
    const created = await caller.playlists.create({ name: "Favorites" });
    await caller.playlists.addItem({
      playlistId: created.id,
      videoId: "dQw4w9WgXcQ",
      channelId: "UCX",
    });
    const lists = await caller.playlists.list();
    expect(lists).toHaveLength(1);
    expect(lists[0]?.itemCount).toBe(1);
    sqlite.close();
  });
});
