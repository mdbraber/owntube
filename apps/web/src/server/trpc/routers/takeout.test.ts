import { describe, expect, it } from "vitest";
import { users, watchHistory } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("takeoutRouter", () => {
  it("imports takeout watch-history entries", async () => {
    const { db, sqlite } = createTestDb();
    const ts = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "takeout@example.com",
        passwordHash: "x",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: users.id })
      .get();
    const caller = appRouter.createCaller({ db, userId: user.id });
    const payload = JSON.stringify([
      {
        titleUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        subtitles: [
          { url: "https://www.youtube.com/channel/UC38IQsAvIsxxjztdMZQtwHA" },
        ],
        time: "2024-01-02T10:00:00.000Z",
      },
    ]);
    const res = await caller.takeout.importHistory({
      payloadJson: payload,
      replaceExisting: false,
    });
    expect(res.imported).toBe(1);
    const rows = db.select().from(watchHistory).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.videoId).toBe("dQw4w9WgXcQ");
    expect(rows[0]?.completed).toBe(1);
    expect(rows[0]?.durationWatched).toBeGreaterThan(0);
    sqlite.close();
  });

  it("imports watch-history.html entries", async () => {
    const { db, sqlite } = createTestDb();
    const ts = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "takeout-html@example.com",
        passwordHash: "x",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: users.id })
      .get();
    const caller = appRouter.createCaller({ db, userId: user.id });
    const payload = `
      <html><body>
      <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">
        Vous avez regardé <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">video</a><br>
        <a href="https://www.youtube.com/channel/UC38IQsAvIsxxjztdMZQtwHA">channel</a><br>
        26 avr. 2026, 15:21:15 CEST<br>
      </div>
      </body></html>
    `;
    const res = await caller.takeout.importHistory({
      payloadJson: payload,
      replaceExisting: false,
    });
    expect(res.imported).toBe(1);
    const rows = db.select().from(watchHistory).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.videoId).toBe("dQw4w9WgXcQ");
    expect(rows[0]?.channelId).toBe("UC38IQsAvIsxxjztdMZQtwHA");
    expect(rows[0]?.completed).toBe(1);
    expect(rows[0]?.durationWatched).toBeGreaterThan(0);
    sqlite.close();
  });

  it("imports subscriptions from takeout CSV", async () => {
    const { db, sqlite } = createTestDb();
    const ts = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "takeout-subs@example.com",
        passwordHash: "x",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: users.id })
      .get();
    const caller = appRouter.createCaller({ db, userId: user.id });
    const payload = [
      "ID des chaînes,URL des chaînes,Titres des chaînes",
      "UC-1c7ebjoZoh1yTM6qL3R7g,http://www.youtube.com/channel/UC-1c7ebjoZoh1yTM6qL3R7g,slash anim",
      "UC-86WpU2f7J_es2gWJSuX-w,http://www.youtube.com/channel/UC-86WpU2f7J_es2gWJSuX-w,CryZENx",
    ].join("\n");

    const res = await caller.takeout.importSubscriptions({
      payloadCsv: payload,
      replaceExisting: false,
    });
    expect(res.imported).toBe(2);

    const list = await caller.subscriptions.list();
    const ids = list.map((s) => s.channelId).sort();
    expect(ids).toEqual([
      "UC-1c7ebjoZoh1yTM6qL3R7g",
      "UC-86WpU2f7J_es2gWJSuX-w",
    ]);
    sqlite.close();
  });
});
