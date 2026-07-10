import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRssInFlight,
  getChannelRssEntries,
  getLongFormWindow,
  refreshChannelRss,
} from "@/server/rss/cache";
import { videoCache } from "@/server/db/schema";
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
    const fetchFn = stubFetchXml([rssXml("vid00000001", "2026-07-01T00:00:00Z")]);

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
    const fetchFn = stubFetchXml([rssXml("vid00000002", "2026-07-02T00:00:00Z")]);

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

  it("keeps the previous row when the live refresh fails", async () => {
    const { db, sqlite } = createTestDb();
    stubFetchXml([rssXml("vid00000001", "2026-07-01T00:00:00Z")]);
    await refreshChannelRss(db, CHANNEL);
    clearRssInFlight();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const entries = await refreshChannelRss(db, CHANNEL);
    expect(entries[0]?.videoId).toBe("vid00000001");
    sqlite.close();
  });

  it("caches an absent long-form window instead of refetching each read", async () => {
    const { db, sqlite } = createTestDb();
    const fetchFn = stubFetchXml(["<?xml version=\"1.0\"?><feed></feed>"]);

    expect(await getLongFormWindow(db, CHANNEL)).toBeNull();
    expect(await getLongFormWindow(db, CHANNEL)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1); // "missing" marker cached
    sqlite.close();
  });

  it("shares one upstream fetch across concurrent readers", async () => {
    const { db, sqlite } = createTestDb();
    const fetchFn = stubFetchXml([rssXml("vid00000001", "2026-07-01T00:00:00Z")]);

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
