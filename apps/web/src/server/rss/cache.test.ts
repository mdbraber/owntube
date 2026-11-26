import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscriptions, users, videoCache } from "@/server/db/schema";
import {
  clearRssInFlight,
  getChannelRssEntries,
  getLongFormWindow,
  isChannelRssFresh,
  isLongFormWindowFresh,
  refreshChannelRss,
  refreshLongFormWindow,
} from "@/server/rss/cache";
import {
  clearWebSubHealthMemo,
  recordWebSubHealth,
} from "@/server/websub/health";
import { createTestDb } from "@/test/db";

const CHANNEL = "UCabcdefghijklmnopqrstuv";

function rssXml(videoId: string, published: string): string {
  return `<?xml version="1.0"?><feed>
    <entry>
      <yt:videoId>${videoId}</yt:videoId>
      <title>Video ${videoId}</title>
      <published>${published}</published>
      <author><name>Chan</name></author>
    </entry>
  </feed>`;
}

function stubFetchXml(bodies: string[]): ReturnType<typeof vi.fn> {
  let call = 0;
  const fn = vi.fn(async () => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call++;
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("rss cache", () => {
  beforeEach(() => {
    clearRssInFlight();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks on the live fetch only for a never-seen channel, then reads SQLite", async () => {
    const { db, sqlite } = createTestDb();
    const fetchFn = stubFetchXml([
      rssXml("vid00000001", "2026-07-01T00:00:00Z"),
    ]);

    const first = await getChannelRssEntries(db, CHANNEL);
    expect(first).toHaveLength(1);
    expect(first[0]?.videoId).toBe("vid00000001");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const second = await getChannelRssEntries(db, CHANNEL);
    expect(second).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1); // fresh row: no live fetch
    sqlite.close();
  });

  it("serves a stale row immediately and revalidates in the background", async () => {
    const { db, sqlite } = createTestDb();
    stubFetchXml([rssXml("vid00000001", "2026-07-01T00:00:00Z")]);
    await refreshChannelRss(db, CHANNEL);

    // Expire the row.
    db.update(videoCache).set({ expiresAt: 1 }).run();
    clearRssInFlight();
    const fetchFn = stubFetchXml([
      rssXml("vid00000002", "2026-07-02T00:00:00Z"),
    ]);

    const served = await getChannelRssEntries(db, CHANNEL);
    expect(served[0]?.videoId).toBe("vid00000001"); // stale answer, no blocking
    expect(fetchFn).toHaveBeenCalledTimes(1); // background revalidation started

    await vi.waitFor(async () => {
      clearRssInFlight();
      const after = await getChannelRssEntries(db, CHANNEL);
      expect(after[0]?.videoId).toBe("vid00000002"); // refreshed row landed
    });
    sqlite.close();
  });

  it("blocks on the live fetch when the only row is months old", async () => {
    const { db, sqlite } = createTestDb();
    stubFetchXml([rssXml("vid00000001", "2026-07-01T00:00:00Z")]);
    await refreshChannelRss(db, CHANNEL);

    db.update(videoCache).set({ expiresAt: 1, fetchedAt: 1 }).run();
    clearRssInFlight();
    stubFetchXml([rssXml("vid00000002", "2026-07-02T00:00:00Z")]);

    const served = await getChannelRssEntries(db, CHANNEL);
    expect(served[0]?.videoId).toBe("vid00000002");
    sqlite.close();
  });

  it("keeps the previous row when the live refresh fails", async () => {
    const { db, sqlite } = createTestDb();
    stubFetchXml([rssXml("vid00000001", "2026-07-01T00:00:00Z")]);
    await refreshChannelRss(db, CHANNEL);
    clearRssInFlight();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const entries = await refreshChannelRss(db, CHANNEL);
    expect(entries[0]?.videoId).toBe("vid00000001");
    sqlite.close();
  });

  it("caches an absent long-form window instead of refetching each read", async () => {
    const { db, sqlite } = createTestDb();
    const fetchFn = stubFetchXml(['<?xml version="1.0"?><feed></feed>']);

    expect(await getLongFormWindow(db, CHANNEL)).toBeNull();
    expect(await getLongFormWindow(db, CHANNEL)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1); // "missing" marker cached
    sqlite.close();
  });

  it("shares one upstream fetch across concurrent readers", async () => {
    const { db, sqlite } = createTestDb();
    const fetchFn = stubFetchXml([
      rssXml("vid00000001", "2026-07-01T00:00:00Z"),
    ]);

    const [a, b, c] = await Promise.all([
      getChannelRssEntries(db, CHANNEL),
      getChannelRssEntries(db, CHANNEL),
      getChannelRssEntries(db, CHANNEL),
    ]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    sqlite.close();
  });
});

describe("rss freshness", () => {
  beforeEach(() => {
    clearRssInFlight();
    clearWebSubHealthMemo();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function age(db: ReturnType<typeof createTestDb>["db"], seconds: number) {
    const now = Math.floor(Date.now() / 1000);
    db.update(videoCache)
      .set({ fetchedAt: now - seconds })
      .run();
    clearWebSubHealthMemo();
  }

  function subscribe(db: ReturnType<typeof createTestDb>["db"]) {
    const t = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({ email: "a@b.c", passwordHash: "x", createdAt: t, updatedAt: t })
      .returning()
      .get();
    db.insert(subscriptions)
      .values({ userId: user.id, channelId: CHANNEL, subscribedAt: t })
      .run();
  }

  it("polls an unsubscribed channel every 15 minutes", async () => {
    const { db, sqlite } = createTestDb();
    stubFetchXml([rssXml("vid00000001", "2026-07-01T00:00:00Z")]);
    await refreshChannelRss(db, CHANNEL);
    age(db, 10 * 60);
    expect(isChannelRssFresh(db, CHANNEL)).toBe(true);
    age(db, 20 * 60);
    expect(isChannelRssFresh(db, CHANNEL)).toBe(false);
    sqlite.close();
  });

  it("keeps a subscribed channel fresh for hours while WebSub is healthy", async () => {
    const { db, sqlite } = createTestDb();
    subscribe(db);
    stubFetchXml([rssXml("vid00000001", "2026-07-01T00:00:00Z")]);
    await refreshChannelRss(db, CHANNEL);
    recordWebSubHealth(db, { wanted: 1, active: 1, failing: 0 });

    age(db, 2 * 3600);
    expect(isChannelRssFresh(db, CHANNEL)).toBe(true);
    const fetchFn = stubFetchXml([
      rssXml("vid00000002", "2026-07-02T00:00:00Z"),
    ]);
    const entries = await getChannelRssEntries(db, CHANNEL);
    expect(entries[0]?.videoId).toBe("vid00000001");
    expect(fetchFn).not.toHaveBeenCalled();

    age(db, 7 * 3600);
    expect(isChannelRssFresh(db, CHANNEL)).toBe(false);
    sqlite.close();
  });

  it("falls back to polling when WebSub stops syncing", async () => {
    const { db, sqlite } = createTestDb();
    subscribe(db);
    stubFetchXml([rssXml("vid00000001", "2026-07-01T00:00:00Z")]);
    await refreshChannelRss(db, CHANNEL);
    const longAgo = Math.floor(Date.now() / 1000) - 3600;
    recordWebSubHealth(db, { wanted: 1, active: 1, failing: 0 }, longAgo);
    age(db, 2 * 3600);
    expect(isChannelRssFresh(db, CHANNEL)).toBe(false);
    sqlite.close();
  });

  it("keeps a long-form window until the RSS lists a newer upload", async () => {
    const { db, sqlite } = createTestDb();
    const now = Math.floor(Date.now() / 1000);
    const older = new Date((now - 3 * 3600) * 1000).toISOString();
    stubFetchXml([rssXml("vid00000001", older)]);
    await refreshLongFormWindow(db, CHANNEL);
    await refreshChannelRss(db, CHANNEL);
    // Window 2 h old, RSS just fetched and listing nothing newer than it.
    const window = db
      .select()
      .from(videoCache)
      .all()
      .find((r) => r.cacheKey.includes("uulf"));
    if (!window) throw new Error("no long-form window row");
    db.update(videoCache)
      .set({ fetchedAt: now - 2 * 3600 })
      .where(eq(videoCache.cacheKey, window.cacheKey))
      .run();
    expect(isLongFormWindowFresh(db, CHANNEL)).toBe(true);

    // The RSS now lists an upload from an hour ago: newer than the window.
    clearRssInFlight();
    stubFetchXml([
      rssXml("vid00000002", new Date((now - 3600) * 1000).toISOString()),
    ]);
    await refreshChannelRss(db, CHANNEL);
    expect(isLongFormWindowFresh(db, CHANNEL)).toBe(false);
    sqlite.close();
  });
});
