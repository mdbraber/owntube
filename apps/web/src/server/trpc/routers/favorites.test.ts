import { describe, expect, it, vi } from "vitest";
import { subscriptions, users } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

// The real helper also warms channel caches upstream; the row is what matters.
vi.mock("@/server/subscriptions/subscribe", () => ({
  subscribeToChannel: async (
    db: ReturnType<typeof createTestDb>["db"],
    userId: number,
    channelId: string,
  ) => {
    db.insert(subscriptions)
      .values({ userId, channelId, subscribedAt: 1 })
      .onConflictDoNothing()
      .run();
  },
}));

function setup() {
  const { db, sqlite } = createTestDb();
  const ts = Math.floor(Date.now() / 1000);
  const user = db
    .insert(users)
    .values({
      email: "fav@example.com",
      passwordHash: "x",
      createdAt: ts,
      updatedAt: ts,
    })
    .returning({ id: users.id })
    .get();
  return {
    db,
    sqlite,
    caller: appRouter.createCaller({ db, userId: user.id }),
  };
}

const CHANNEL = "UCxxxxxxxxxxxxxxxxxxxxxx";

describe("favoritesRouter", () => {
  it("starring subscribes and tags; unstarring keeps the subscription", async () => {
    const { sqlite, caller } = setup();
    expect(await caller.favorites.status({ channelId: CHANNEL })).toEqual({
      favorite: false,
      tag: "favorite",
    });

    await caller.favorites.set({ channelId: CHANNEL, favorite: true });
    expect(
      (await caller.favorites.status({ channelId: CHANNEL })).favorite,
    ).toBe(true);
    expect(
      (await caller.subscriptions.status({ channelId: CHANNEL })).subscribed,
    ).toBe(true);
    expect(
      await caller.channelTags.listForChannel({ channelId: CHANNEL }),
    ).toEqual(["favorite"]);
    expect(
      (await caller.subscriptions.listTagged({ favorites: true })).map(
        (c) => c.channelId,
      ),
    ).toEqual([CHANNEL]);

    await caller.favorites.set({ channelId: CHANNEL, favorite: false });
    expect(
      (await caller.favorites.status({ channelId: CHANNEL })).favorite,
    ).toBe(false);
    expect(
      (await caller.subscriptions.status({ channelId: CHANNEL })).subscribed,
    ).toBe(true);
    sqlite.close();
  });

  it("uses the favorite tag from settings", async () => {
    const { sqlite, caller } = setup();
    await caller.settings.update({ favoriteTag: "  #Must Watch " });
    expect((await caller.settings.get()).favoriteTag).toBe("must watch");
    await caller.favorites.set({ channelId: CHANNEL, favorite: true });
    expect(
      await caller.channelTags.listForChannel({ channelId: CHANNEL }),
    ).toEqual(["must watch"]);
    sqlite.close();
  });
});
