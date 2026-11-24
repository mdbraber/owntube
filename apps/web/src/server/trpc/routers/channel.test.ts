import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRssInFlight, refreshChannelRss } from "@/server/rss/cache";
import { fetchChannelPage, fetchVideoDetail } from "@/server/services/proxy";
import type { UnifiedVideo, VideoDetail } from "@/server/services/proxy.types";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

vi.mock("@/server/services/proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/proxy")>()),
  fetchChannelPage: vi.fn(),
  fetchVideoDetail: vi.fn(),
}));

const CHANNEL = "UCabcdefghijklmnopqrstuv";
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function video(
  over: Partial<UnifiedVideo> & { videoId: string },
): UnifiedVideo {
  return { title: over.videoId, channelId: CHANNEL, ...over };
}

/** The channel's uploads RSS: its two newest public videos. */
const RSS = `<?xml version="1.0"?><feed>
  <entry><yt:videoId>newerVideo1</yt:videoId><title>a</title>
    <published>2026-09-29T00:00:00Z</published>
    <media:group><media:community><media:statistics views="1000"/></media:community></media:group></entry>
  <entry><yt:videoId>newerVideo2</yt:videoId><title>b</title>
    <published>2026-09-20T00:00:00Z</published>
    <media:group><media:community><media:statistics views="2000"/></media:community></media:group></entry>
</feed>`;

describe("channel.page", () => {
  beforeEach(() => clearRssInFlight());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(fetchChannelPage).mockReset();
    vi.mocked(fetchVideoDetail).mockReset();
  });

  it("puts a repaired row back in its place, not at the top", async () => {
    const { db, sqlite } = createTestDb();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(RSS, { status: 200 })),
    );
    await refreshChannelRss(db, CHANNEL);
    vi.mocked(fetchVideoDetail).mockResolvedValue({
      videoId: "oldBroken01",
      viewCount: 364298,
      publishedAt: at("2026-04-28T00:00:00Z"),
    } as VideoDetail);

    // What fetchChannelPage really hands over: sorted newest-first by the
    // listing's own dates. The broken row is months old but came back as
    // "0 seconds ago" with 0 views, so that sort put it first. It is too old
    // for the RSS; only the single-video endpoint knows its real date.
    const nowSec = Math.floor(Date.now() / 1000);
    vi.mocked(fetchChannelPage).mockResolvedValue({
      channelId: CHANNEL,
      videos: [
        video({
          videoId: "oldBroken01",
          viewCount: 0,
          publishedAt: nowSec,
          publishedText: "0 seconds ago",
        }),
        video({
          videoId: "newerVideo1",
          viewCount: 0,
          publishedAt: at("2026-09-29T00:00:00Z"),
        }),
        video({
          videoId: "newerVideo2",
          viewCount: 1500,
          publishedAt: at("2026-09-20T00:00:00Z"),
        }),
        video({
          videoId: "oldFine0001",
          viewCount: 50,
          publishedAt: at("2026-04-01T00:00:00Z"),
        }),
      ],
      continuation: null,
      sourceUsed: "invidious",
      stale: false,
    });

    const caller = appRouter.createCaller({ db, userId: null });
    const page = await caller.channel.page({ channelId: CHANNEL });

    // Repaired, then sorted by the real dates: between September and April 1.
    expect(page.videos.map((v) => v.videoId)).toEqual([
      "newerVideo1",
      "newerVideo2",
      "oldBroken01",
      "oldFine0001",
    ]);
    const byId = new Map(page.videos.map((v) => [v.videoId, v]));
    expect(byId.get("oldBroken01")?.viewCount).toBe(364298);
    // Rows the RSS covers are corrected from it; a real listing count stays.
    expect(byId.get("newerVideo1")?.viewCount).toBe(1000);
    expect(byId.get("newerVideo2")?.viewCount).toBe(1500);
    sqlite.close();
  });
});
