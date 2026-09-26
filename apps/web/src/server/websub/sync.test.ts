import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscriptions, users, websubPushed } from "@/server/db/schema";
import { clearRssInFlight, getChannelRssEntries } from "@/server/rss/cache";
import { nowUnix } from "@/server/services/proxy/cache";
import { warmVideo } from "@/server/warm-cache/warm-video";
import { createTestDb } from "@/test/db";
import { syncWebSub, type WebSubEvent } from "./sync";

vi.mock("@/server/warm-cache/warm-video", () => ({
  warmVideo: vi.fn(async () => true),
}));

const CHANNEL = "UCabcdefghijklmnopqrstuv";
const TARGET = "https://feeds.example";

function rssXml(videoIds: string[], published: string): string {
  const entries = videoIds
    .map(
      (id) => `<entry>
        <yt:videoId>${id}</yt:videoId>
        <title>Video ${id}</title>
        <published>${published}</published>
        <author><name>Chan</name></author>
      </entry>`,
    )
    .join("");
  return `<?xml version="1.0"?><feed>${entries}</feed>`;
}

function seed() {
  const { db, sqlite } = createTestDb();
  const t = nowUnix();
  const user = db
    .insert(users)
    .values({ email: "a@b.c", passwordHash: "x", createdAt: t, updatedAt: t })
    .returning()
    .get();
  db.insert(subscriptions)
    .values({ userId: user.id, channelId: CHANNEL, subscribedAt: t })
    .run();
  return { db, sqlite };
}

/**
 * Stub fetch: `/websub/sync` serves the queued batches in order (then empty);
 * youtube.com serves `rss` for the channel feed and an empty long-form window.
 */
function stubFetch(opts: {
  batches: WebSubEvent[][];
  rss: () => string;
  syncStatus?: number;
}) {
  const syncBodies: { channels: string[]; ack: number | null }[] = [];
  let batch = 0;
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${TARGET}/websub/sync`) {
      syncBodies.push(JSON.parse(String(init?.body)));
      if (opts.syncStatus) return new Response("", { status: opts.syncStatus });
      const events = opts.batches[batch++] ?? [];
      return Response.json({
        events,
        stats: { wanted: 1, active: 1, pending: 0, failing: 0, queued: 0 },
      });
    }
    if (url.includes("playlist_id=")) {
      return new Response("<feed></feed>", { status: 200 });
    }
    return new Response(opts.rss(), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, syncBodies };
}

describe("syncWebSub", () => {
  beforeEach(() => {
    clearRssInFlight();
    vi.mocked(warmVideo).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("overlays a push the lagging RSS lacks, and resolves it once the feed catches up", async () => {
    const { db, sqlite } = seed();
    const published = nowUnix() - 60;
    let rss = rssXml(["old00000001"], "2026-01-01T00:00:00Z");
    const { syncBodies } = stubFetch({
      batches: [
        [
          {
            id: 7,
            channelId: CHANNEL,
            videoId: "new00000001",
            deleted: false,
            title: "Fresh upload",
            author: "Chan",
            publishedAt: published,
          },
        ],
      ],
      rss: () => rss,
    });

    const result = await syncWebSub(db, { target: TARGET, secret: "s" });
    expect(result).toMatchObject({
      enabled: true,
      events: 1,
      channels: 1,
      warmed: 1,
    });
    // New upload warmed, without SponsorBlock (no segments exist yet).
    expect(warmVideo).toHaveBeenCalledWith(db, "new00000001", {
      sponsorBlock: false,
    });
    // Subscribed set sent; the batch acked on the follow-up call.
    expect(syncBodies[0]).toEqual({ channels: [CHANNEL], ack: null });
    expect(syncBodies.at(-1)?.ack).toBe(7);

    const entries = await getChannelRssEntries(db, CHANNEL);
    expect(entries.map((e) => e.videoId)).toEqual([
      "new00000001",
      "old00000001",
    ]);
    expect(entries[0]).toMatchObject({
      title: "Fresh upload",
      publishedAt: published,
    });

    // The feed now lists it: the next refresh resolves the push.
    rss = rssXml(
      ["new00000001", "old00000001"],
      new Date(published * 1000).toISOString(),
    );
    db.update(websubPushed).set({ checkedAt: 0 }).run();
    clearRssInFlight();
    const again = await syncWebSub(db, { target: TARGET, secret: "s" });
    expect(again).toMatchObject({ enabled: true, events: 0, rechecked: 1 });
    expect(db.select().from(websubPushed).all()).toHaveLength(0);
    sqlite.close();
  });

  it("tombstones filter a deleted video out even while the RSS still lists it", async () => {
    const { db, sqlite } = seed();
    stubFetch({
      batches: [
        [
          {
            id: 1,
            channelId: CHANNEL,
            videoId: "gone0000001",
            deleted: true,
          },
        ],
      ],
      rss: () => rssXml(["gone0000001", "keep0000001"], "2026-09-01T00:00:00Z"),
    });
    await syncWebSub(db, { target: TARGET, secret: "s" });
    const entries = await getChannelRssEntries(db, CHANNEL);
    expect(entries.map((e) => e.videoId)).toEqual(["keep0000001"]);
    expect(warmVideo).not.toHaveBeenCalled();
    sqlite.close();
  });

  it("does not overlay edits of old videos", async () => {
    const { db, sqlite } = seed();
    stubFetch({
      batches: [
        [
          {
            id: 1,
            channelId: CHANNEL,
            videoId: "ancient0001",
            deleted: false,
            title: "Retitled",
            publishedAt: nowUnix() - 90 * 86_400,
          },
        ],
      ],
      rss: () => rssXml(["recent00001"], "2026-09-01T00:00:00Z"),
    });
    const result = await syncWebSub(db, { target: TARGET, secret: "s" });
    expect(result).toMatchObject({ events: 1, channels: 1, warmed: 0 });
    expect(warmVideo).not.toHaveBeenCalled();
    expect(db.select().from(websubPushed).all()).toHaveLength(0);
    const entries = await getChannelRssEntries(db, CHANNEL);
    expect(entries.map((e) => e.videoId)).toEqual(["recent00001"]);
    sqlite.close();
  });

  it("reports disabled when the feeds server has WebSub off", async () => {
    const { db, sqlite } = seed();
    stubFetch({ batches: [], rss: () => "", syncStatus: 404 });
    expect(await syncWebSub(db, { target: TARGET, secret: "s" })).toEqual({
      enabled: false,
    });
    sqlite.close();
  });

  it("throws on other server errors so the caller can log them", async () => {
    const { db, sqlite } = seed();
    stubFetch({ batches: [], rss: () => "", syncStatus: 401 });
    await expect(
      syncWebSub(db, { target: TARGET, secret: "s" }),
    ).rejects.toThrow(/401/);
    sqlite.close();
  });
});
