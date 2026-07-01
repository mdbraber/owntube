import { describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("interactionsRouter", () => {
  it("toggles interaction state", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "interactions@example.com",
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();

    const caller = appRouter.createCaller({ db, userId: user.id });
    await caller.interactions.set({
      videoId: "dQw4w9WgXcQ",
      channelId: "UC1",
      type: "like",
      active: true,
    });
    const state = await caller.interactions.state({ videoId: "dQw4w9WgXcQ" });
    expect(state.like).toBe(true);
    sqlite.close();
  });
});
