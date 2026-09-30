import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRssInFlight, refreshChannelRss } from "@/server/rss/cache";
import { patchVideosWithChannelRss } from "@/server/rss/patch";
import { fetchVideoDetail } from "@/server/services/proxy";
import type { UnifiedVideo, VideoDetail } from "@/server/services/proxy.types";
import { createTestDb } from "@/test/db";

vi.mock("@/server/services/proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/proxy")>()),
  fetchVideoDetail: vi.fn(),
}));

const CHANNEL = "UCabcdefghijklmnopqrstuv";
const PUBLISHED = "2026-07-16T12:00:00Z";
const PUBLISHED_SEC = Math.floor(Date.parse(PUBLISHED) / 1000);

/** One uploads-feed entry, with a view count and the channel's name. */
function feed(videoId: string, views: number): string {
  return `<?xml version="1.0"?><feed>
    <entry>
      <yt:videoId>${videoId}</yt:videoId>
      <title>Video ${videoId}</title>
      <published>${PUBLISHED}</published>
      <author><name>Chan</name></author>
      <media:group><media:community>
        <media:statistics views="${views}"/>
      </media:community></media:group>
    </entry>
  </feed>`;
}

async function seedFeed(
  db: ReturnType<typeof createTestDb>["db"],
  xml: string,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(xml, { status: 200 })),
  );
  await refreshChannelRss(db, CHANNEL);
}

function video(
  over: Partial<UnifiedVideo> & { videoId: string },
): UnifiedVideo {
  return { title: over.videoId, channelId: CHANNEL, ...over };
}

describe("patchVideosWithChannelRss", () => {
  beforeEach(() => clearRssInFlight());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(fetchVideoDetail).mockReset();
  });

  it("repairs a listing row that came back as 'now' with zero views", async () => {
    const { db, sqlite } = createTestDb();
    await seedFeed(db, feed("Iq34gq2ihMk", 449214));
    const nowSec = Math.floor(Date.now() / 1000);

    const [v] = await patchVideosWithChannelRss(db, [
      video({
        videoId: "Iq34gq2ihMk",
        viewCount: 0,
        publishedAt: nowSec,
        publishedText: "0 seconds ago",
      }),
    ]);

    expect(v?.viewCount).toBe(449214);
    expect(v?.publishedAt).toBe(PUBLISHED_SEC);
    expect(v?.publishedText).toBe(new Date(PUBLISHED_SEC * 1000).toISOString());
    sqlite.close();
  });

  it("keeps a real view count from the listing — it is fresher than the RSS", async () => {
    const { db, sqlite } = createTestDb();
    await seedFeed(db, feed("vid00000001", 100));
    const [v] = await patchVideosWithChannelRss(db, [
      video({ videoId: "vid00000001", viewCount: 150 }),
    ]);
    expect(v?.viewCount).toBe(150);
    sqlite.close();
  });

  it("fills a missing view count, not only a zero one", async () => {
    const { db, sqlite } = createTestDb();
    await seedFeed(db, feed("vid00000001", 42));
    const [v] = await patchVideosWithChannelRss(db, [
      video({ videoId: "vid00000001" }),
    ]);
    expect(v?.viewCount).toBe(42);
    sqlite.close();
  });

  it("falls back to the feed's channel name when the listing has none", async () => {
    const { db, sqlite } = createTestDb();
    await seedFeed(db, feed("vid00000001", 1));
    const [named, unnamed] = await patchVideosWithChannelRss(db, [
      video({ videoId: "vid00000001", channelName: "Listing name" }),
      video({ videoId: "vid00000001", channelName: "  " }),
    ]);
    expect(named?.channelName).toBe("Listing name");
    expect(unnamed?.channelName).toBe("Chan");
    sqlite.close();
  });

  it("leaves videos the feed doesn't list untouched", async () => {
    const { db, sqlite } = createTestDb();
    await seedFeed(db, feed("vid00000001", 1));
    const other = video({
      videoId: "notInFeed1",
      viewCount: 0,
      publishedAt: 5,
    });
    const [v] = await patchVideosWithChannelRss(db, [other]);
    expect(v).toEqual(other);
    sqlite.close();
  });

  describe("rows the RSS can't reach", () => {
    const APRIL = Math.floor(Date.parse("2026-04-28T00:00:00Z") / 1000);

    it("repairs an older broken row from the single-video endpoint", async () => {
      const { db, sqlite } = createTestDb();
      await seedFeed(db, feed("vid00000001", 1));
      vi.mocked(fetchVideoDetail).mockResolvedValue({
        videoId: "yUM_QMlRXX8",
        viewCount: 364298,
        publishedAt: APRIL,
      } as VideoDetail);

      const [v] = await patchVideosWithChannelRss(db, [
        video({
          videoId: "yUM_QMlRXX8",
          viewCount: 0,
          publishedAt: Math.floor(Date.now() / 1000),
          publishedText: "0 seconds ago",
        }),
      ]);

      expect(fetchVideoDetail).toHaveBeenCalledTimes(1);
      expect(v?.viewCount).toBe(364298);
      expect(v?.publishedAt).toBe(APRIL);
      expect(v?.publishedText).toBe(new Date(APRIL * 1000).toISOString());
      sqlite.close();
    });

    it("never asks about a members-only row — zero views, ordinary date", async () => {
      const { db, sqlite } = createTestDb();
      await seedFeed(db, feed("vid00000001", 1));
      const membersOnly = video({
        videoId: "SDy63Z_LiwE",
        viewCount: 0,
        publishedText: "1 week ago",
      });

      const [v] = await patchVideosWithChannelRss(db, [membersOnly]);

      expect(fetchVideoDetail).not.toHaveBeenCalled();
      expect(v).toEqual(membersOnly);
      sqlite.close();
    });

    it("leaves the row as it was when the detail can't be had", async () => {
      const { db, sqlite } = createTestDb();
      await seedFeed(db, feed("vid00000001", 1));
      vi.mocked(fetchVideoDetail).mockRejectedValue(new Error("rate limit"));
      const broken = video({
        videoId: "yUM_QMlRXX8",
        viewCount: 0,
        publishedText: "0 seconds ago",
      });

      const [v] = await patchVideosWithChannelRss(db, [broken]);

      expect(v).toEqual(broken);
      sqlite.close();
    });

    it("doesn't ask when the RSS already repaired the row", async () => {
      const { db, sqlite } = createTestDb();
      await seedFeed(db, feed("Iq34gq2ihMk", 449214));

      await patchVideosWithChannelRss(db, [
        video({
          videoId: "Iq34gq2ihMk",
          viewCount: 0,
          publishedText: "0 seconds ago",
        }),
      ]);

      expect(fetchVideoDetail).not.toHaveBeenCalled();
      sqlite.close();
    });
  });
});
