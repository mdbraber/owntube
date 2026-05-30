import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { videoCache } from "@/server/db/schema";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import {
  fetchChannelPage,
  fetchRelatedVideos,
  fetchTrendingVideos,
  fetchVideoComments,
  fetchVideoDetail,
  searchVideos,
} from "@/server/services/proxy";
import * as rateLimiter from "@/server/services/rate-limiter";
import { resetRateLimiterForTests } from "@/server/services/rate-limiter";
import { createTestDb } from "@/test/db";

describe("searchVideos", () => {
  beforeEach(() => {
    resetRateLimiterForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("fetch not mocked for this test"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PIPED_BASE_URL;
    delete process.env.INVIDIOUS_BASE_URL;
    delete process.env.PORT;
  });

  it("parses Piped channel items from search (url + title)", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              type: "channel",
              url: "/channel/UCuAXFkgsw1L7xaCfnd5JJOw",
              title: "Rick Astley",
              thumbnail: "/avatars/rick.jpg",
              subscriberCount: 4_200_000,
            },
            {
              type: "stream",
              url: "/watch?v=dQw4w9WgXcQ",
              title: "Example",
              uploaderUrl: "/channel/UCother",
            },
          ],
          nextpage: "",
        }),
      ),
    );

    const r = await searchVideos(db, { q: "rick", limit: 10 });
    expect(r.channels).toHaveLength(1);
    expect(r.channels?.[0]?.channelId).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(r.channels?.[0]?.name).toBe("Rick Astley");
    expect(r.channels?.[0]?.avatarUrl).toBe(
      "https://piped.test/avatars/rick.jpg",
    );
    expect(r.channels?.[0]?.subscriberCount).toBe(4_200_000);
    sqlite.close();
  });

  it("collects channels after video limit in Piped search", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";

    const videoItems = Array.from({ length: 20 }, (_, i) => ({
      type: "stream",
      url: `/watch?v=${String(i).padStart(11, "0")}`,
      title: `Video ${i}`,
      uploaderUrl: "/channel/UCvideos",
    }));
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            ...videoItems,
            {
              type: "channel",
              url: "/channel/UCchannelAfterVideos",
              title: "Late Channel",
            },
          ],
          nextpage: "",
        }),
      ),
    );

    const r = await searchVideos(db, { q: "mix", limit: 20 });
    expect(r.videos).toHaveLength(20);
    expect(
      r.channels?.some((c) => c.channelId === "UCchannelAfterVideos"),
    ).toBe(true);
    sqlite.close();
  });

  it("returns unified videos from Piped-shaped JSON", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              type: "stream",
              url: "/watch?v=dQw4w9WgXcQ",
              title: "Example",
              thumbnail: "https://example.com/t.jpg",
              duration: 212,
              views: 1000,
              uploaderName: "Channel",
              uploaderUrl: "/channel/UCuAXFkgsw1L7xaCfnd5JJOw",
              uploaderAvatar: "/avatars/u.jpg",
            },
          ],
          nextpage: "",
        }),
      ),
    );

    const r = await searchVideos(db, { q: "music", limit: 10 });
    expect(r.sourceUsed).toBe("piped");
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0]?.videoId).toBe("dQw4w9WgXcQ");
    expect(r.videos[0]?.channelId).toBe("UCuAXFkgsw1L7xaCfnd5JJOw");
    expect(r.videos[0]?.channelAvatarUrl).toBe(
      "https://piped.test/avatars/u.jpg",
    );
    sqlite.close();
  });

  it("drops Piped streams whose title indicates members-only", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              type: "stream",
              url: "/watch?v=MEMBERSTITLE",
              title: "Bonus clip (Members only)",
              uploaderUrl: "/channel/UCx",
            },
            {
              type: "stream",
              url: "/watch?v=dQw4w9WgXcQ",
              title: "Public upload",
              uploaderUrl: "/channel/UCx",
            },
          ],
          nextpage: "",
        }),
      ),
    );

    const r = await searchVideos(db, { q: "q", limit: 10 });
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0]?.videoId).toBe("dQw4w9WgXcQ");
    sqlite.close();
  });

  it("drops Piped streams marked premium or paid from unified lists", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              type: "stream",
              url: "/watch?v=ONLYMEMBERS",
              title: "Members only",
              premium: true,
              uploaderUrl: "/channel/UCx",
            },
            {
              type: "stream",
              url: "/watch?v=dQw4w9WgXcQ",
              title: "Public",
              uploaderUrl: "/channel/UCx",
            },
          ],
          nextpage: "",
        }),
      ),
    );

    const r = await searchVideos(db, { q: "q", limit: 10 });
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0]?.videoId).toBe("dQw4w9WgXcQ");
    sqlite.close();
  });

  it("parses Piped view counts sent as strings or alternate keys", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              type: "stream",
              url: "/watch?v=dQw4w9WgXcQ",
              title: "String views",
              viewCount: "2500000",
              uploaderUrl: "/channel/UCx",
            },
            {
              type: "stream",
              url: "/watch?v=abcdefghijk",
              title: "K suffix",
              views: "1.2M",
              uploaderUrl: "/channel/UCy",
            },
          ],
        }),
      ),
    );

    const r = await searchVideos(db, { q: "views", limit: 10 });
    expect(r.videos[0]?.viewCount).toBe(2_500_000);
    expect(r.videos[1]?.viewCount).toBe(1_200_000);
    sqlite.close();
  });

  it("parses Invidious channel items from search", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              type: "channel",
              authorId: "UCinvchan",
              author: "Inv Channel",
              authorThumbnails: [
                { url: "https://example.com/ch.jpg", width: 88, quality: "" },
              ],
              subCount: 99_000,
            },
          ]),
        ),
      );

    const r = await searchVideos(db, { q: "chan", limit: 10 });
    expect(r.sourceUsed).toBe("invidious");
    expect(r.channels).toHaveLength(1);
    expect(r.channels?.[0]?.channelId).toBe("UCinvchan");
    expect(r.channels?.[0]?.name).toBe("Inv Channel");
    sqlite.close();
  });

  it("falls back to Invidious when Piped fails", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              type: "video",
              videoId: "abc12345678",
              title: "From Invidious",
              author: "Creator",
              authorId: "UCxyz",
              authorThumbnails: [
                { url: "https://example.com/ch.jpg", width: 88, quality: "" },
              ],
              videoThumbnails: [{ url: "https://example.com/thumb.jpg" }],
              lengthSeconds: 60,
              viewCount: 500,
              publishedText: "1 day ago",
            },
          ]),
        ),
      );

    const r = await searchVideos(db, { q: "test", limit: 10 });
    expect(r.sourceUsed).toBe("invidious");
    expect(r.videos[0]?.videoId).toBe("abc12345678");
    expect(r.videos[0]?.channelAvatarUrl).toBe("https://example.com/ch.jpg");
    sqlite.close();
  });

  it("drops Invidious videos marked premium or paid from unified lists", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              type: "video",
              videoId: "paidONLY00001",
              title: "Paid",
              paid: true,
              author: "A",
              authorId: "UCa",
              videoThumbnails: [{ url: "https://example.com/t.jpg" }],
              lengthSeconds: 5,
            },
            {
              type: "video",
              videoId: "abc12345678",
              title: "Ok",
              author: "B",
              authorId: "UCb",
              videoThumbnails: [{ url: "https://example.com/t2.jpg" }],
              lengthSeconds: 10,
            },
          ]),
        ),
      );

    const r = await searchVideos(db, { q: "test", limit: 10 });
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0]?.videoId).toBe("abc12345678");
    sqlite.close();
  });

  it("serves stale cache when both upstreams fail", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              type: "stream",
              url: "/watch?v=dQw4w9WgXcQ",
              title: "Cached",
            },
          ],
        }),
      ),
    );
    await searchVideos(db, { q: "cache-me", limit: 10 });
    db.update(videoCache).set({ expiresAt: 0 }).run();

    vi.mocked(fetch).mockRejectedValue(new Error("down"));
    const stale = await searchVideos(db, { q: "cache-me", limit: 10 });
    expect(stale.sourceUsed).toBe("cache");
    expect(stale.stale).toBe(true);
    expect(stale.warning).toContain("stale cache");
    sqlite.close();
  });

  it("returns video detail from Piped stream endpoint", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          videoId: "dQw4w9WgXcQ",
          title: "Stream title",
          uploader: "Streamer",
          uploaderId: "UC1",
          hls: "https://media.example.com/master.m3u8",
          audioStreams: [{ url: "https://media.example.com/audio.m4a" }],
          videoStreams: [{ url: "https://media.example.com/video.mp4" }],
        }),
      ),
    );
    const detail = await fetchVideoDetail(db, { videoId: "dQw4w9WgXcQ" });
    expect(detail.sourceUsed).toBe("piped");
    expect(detail.hlsUrl).toContain(".m3u8");
    sqlite.close();
  });

  it("maps Piped livestream with isLive and no zero duration", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    delete process.env.INVIDIOUS_BASE_URL;
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          videoId: "jfKfPfyJRdk",
          title: "Lofi Girl",
          livestream: true,
          duration: 0,
          hls: "https://media.example.com/live.m3u8",
          audioStreams: [],
          videoStreams: [
            { url: "https://media.example.com/video.mp4", quality: "360p" },
          ],
        }),
      ),
    );
    const detail = await fetchVideoDetail(db, { videoId: "jfKfPfyJRdk" });
    expect(detail.isLive).toBe(true);
    expect(detail.durationSeconds).toBeUndefined();
    expect(detail.hlsUrl).toContain(".m3u8");
    sqlite.close();
  });

  it("maps Invidious liveNow on video detail", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "http://127.0.0.1:3001";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          videoId: "jfKfPfyJRdk",
          title: "Live stream",
          liveNow: true,
          lengthSeconds: 0,
          hlsUrl: "http://127.0.0.1:3001/api/manifest/hls/playlist/jfKfPfyJRdk",
          adaptiveFormats: [],
          formatStreams: [],
        }),
      ),
    );
    const detail = await fetchVideoDetail(db, { videoId: "jfKfPfyJRdk" });
    expect(detail.isLive).toBe(true);
    expect(detail.durationSeconds).toBeUndefined();
    sqlite.close();
  });

  it("throws UpstreamLiveUpcomingError for scheduled Invidious premiere", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "http://127.0.0.1:3001";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "This live event will begin in 56 minutes.",
        }),
        { status: 500 },
      ),
    );
    const { UpstreamLiveUpcomingError } = await import(
      "@/server/errors/upstream-live-upcoming"
    );
    await expect(
      fetchVideoDetail(db, { videoId: "upcomingLiveId1" }),
    ).rejects.toBeInstanceOf(UpstreamLiveUpcomingError);
    sqlite.close();
  });

  it("maps liveNow on Invidious search items", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "http://127.0.0.1:3001";
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            type: "video",
            videoId: "liveVid12345",
            title: "24/7 Stream",
            author: "Channel",
            authorId: "UCx",
            liveNow: true,
            lengthSeconds: 0,
            videoThumbnails: [
              {
                quality: "medium",
                url: "/vi/liveVid12345/mqdefault.jpg",
                width: 320,
                height: 180,
              },
            ],
          },
        ]),
      ),
    );
    const result = await searchVideos(db, { q: "lofi live", limit: 5 });
    expect(result.videos[0]?.isLive).toBe(true);
    expect(result.videos[0]?.durationSeconds).toBeUndefined();
    sqlite.close();
  });

  it("maps Piped stream when videoId is only in the request path", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    delete process.env.INVIDIOUS_BASE_URL;
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "No id in payload",
          uploader: "Artist",
          uploaderUrl: "/channel/UCchan",
          proxyUrl: "https://piped.test",
          thumbnailUrl: "https://piped.test/vi/abcdefghijk/hqdefault.jpg",
          audioStreams: [
            {
              url: "https://piped.test/videoplayback?itag=140",
              mimeType: "audio/mp4",
            },
          ],
          videoStreams: [
            {
              url: "https://piped.test/videoplayback?itag=137",
              mimeType: "video/mp4",
              codec: "avc1.640028",
              videoOnly: true,
            },
          ],
        }),
      ),
    );
    const detail = await fetchVideoDetail(db, { videoId: "abcdefghijk" });
    expect(detail.sourceUsed).toBe("piped");
    expect(detail.videoId).toBe("abcdefghijk");
    expect(detail.channelId).toBe("UCchan");
    expect(detail.videoSources.length).toBeGreaterThan(0);
    expect(detail.videoSources[0]?.mimeType).toContain("codecs=");
    sqlite.close();
  });

  it("fetchVideoDetail bypassDetailCache skips a fresh SQLite row", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "http://localhost:3001";

    let invCalls = 0;
    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("/api/v1/videos/dQw4w9WgXcQ") && !u.includes("/related")) {
        invCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              videoId: "dQw4w9WgXcQ",
              title: "Invidious",
              hlsUrl: `/api/manifest/hls/playlist/dQw4w9WgXcQ?c=${invCalls}`,
              storyboard: {
                level: 0,
                duration: 60,
                count: 1,
                columns: 1,
                rows: 1,
                interval: 60,
                storyboardWidth: 160,
                storyboardHeight: 90,
                width: 160,
                height: 90,
                images: ["/sb/0.jpg"],
              },
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const d1 = await fetchVideoDetail(db, { videoId: "dQw4w9WgXcQ" });
    expect(d1.hlsUrl).toContain("c=1");
    // Detail + optional storyboard probe share the same Invidious videos endpoint.
    expect(invCalls).toBe(2);

    const d2 = await fetchVideoDetail(db, { videoId: "dQw4w9WgXcQ" });
    expect(d2.hlsUrl).toContain("c=1");
    expect(invCalls).toBe(2);

    const d3 = await fetchVideoDetail(
      db,
      { videoId: "dQw4w9WgXcQ" },
      undefined,
      { bypassDetailCache: true },
    );
    expect(d3.hlsUrl).toContain("c=3");
    expect(invCalls).toBe(4);

    sqlite.close();
  });

  it("loads Piped related from /streams/:id relatedStreams", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "disabled";

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("/streams/dQw4w9WgXcQ") && !u.includes("/related")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              videoId: "dQw4w9WgXcQ",
              title: "Main",
              relatedStreams: [
                {
                  url: "/watch?v=abc12345678",
                  title: "Related clip",
                  duration: 120,
                  uploaderUrl: "/channel/UCx",
                },
              ],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const related = await fetchRelatedVideos(db, { videoId: "dQw4w9WgXcQ" }, 5);
    expect(related.sourceUsed).toBe("piped");
    expect(related.videos).toHaveLength(1);
    expect(related.videos[0]?.videoId).toBe("abc12345678");
    sqlite.close();
  });

  it("returns related videos from Invidious fallback", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("piped.test")) {
        return Promise.reject(new Error("piped down"));
      }
      if (u.includes("inv.test") && u.includes("/related")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                type: "video",
                videoId: "abc12345678",
                title: "Related",
                author: "Creator",
              },
            ]),
          ),
        );
      }
      if (u.includes("inv.test") && u.includes("/api/v1/videos/dQw4w9WgXcQ")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              videoId: "dQw4w9WgXcQ",
              title: "Main",
              authorId: "UCchan",
              author: "Artist",
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const related = await fetchRelatedVideos(db, { videoId: "dQw4w9WgXcQ" }, 5);
    expect(related.sourceUsed).toBe("invidious");
    expect(related.videos[0]?.videoId).toBe("abc12345678");
    sqlite.close();
  });

  it("fills related from uploader channel when instance returns no related list", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("/streams/dQw4w9WgXcQ") && !u.includes("/related")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              videoId: "dQw4w9WgXcQ",
              title: "Main",
              uploaderId: "UCchan",
              uploader: "Artist",
              relatedStreams: [],
            }),
          ),
        );
      }
      if (u.includes("/streams/") && u.includes("/related")) {
        return Promise.resolve(
          new Response(JSON.stringify({ relatedStreams: [] })),
        );
      }
      if (u.includes("/api/v1/videos/") && u.includes("/related")) {
        return Promise.resolve(new Response("[]"));
      }
      if (u.includes("/channel/UCchan")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "Artist",
              id: "UCchan",
              relatedStreams: [
                {
                  type: "stream",
                  url: "/watch?v=dQw4w9WgXcQ",
                  title: "Main",
                  uploaderUrl: "/channel/UCchan",
                },
                {
                  type: "stream",
                  url: "/watch?v=abcdefghijk",
                  title: "Other upload",
                  uploaderUrl: "/channel/UCchan",
                },
              ],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const r = await fetchRelatedVideos(db, { videoId: "dQw4w9WgXcQ" }, 5);
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0]?.videoId).toBe("abcdefghijk");
    expect(r.warning).toContain("same channel");
    sqlite.close();
  });

  it("treats Invidious 200 with empty body on /related as an empty list", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("/api/v1/videos/") && u.includes("/related")) {
        return Promise.resolve(new Response("", { status: 200 }));
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const r = await fetchRelatedVideos(db, { videoId: "dQw4w9WgXcQ" }, 5);
    expect(r.videos).toEqual([]);
    expect(r.sourceUsed).toBe("invidious");
    sqlite.close();
  });

  it("resolves Invidious relative stream URLs and uses 127.0.0.1 instead of localhost", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "http://localhost:3001";

    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      expect(url).toContain("127.0.0.1");
      expect(url).toContain("/api/v1/videos/dQw4w9WgXcQ");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            videoId: "dQw4w9WgXcQ",
            title: "Invidious relative URLs",
            adaptiveFormats: [
              {
                url: "/api/v1/manifest/dash/id/dQw4w9WgXcQ",
                type: "video/mp4",
                qualityLabel: "720p",
              },
            ],
            hlsUrl: "/api/v1/manifest/hls/playlist/dQw4w9WgXcQ",
          }),
        ),
      );
    });

    const detail = await fetchVideoDetail(db, { videoId: "dQw4w9WgXcQ" });
    expect(detail.sourceUsed).toBe("invidious");
    expect(detail.hlsUrl).toBe(
      "http://127.0.0.1:3001/api/v1/manifest/hls/playlist/dQw4w9WgXcQ",
    );
    expect(detail.videoSources[0]?.url).toBe(
      "http://127.0.0.1:3001/api/v1/manifest/dash/id/dQw4w9WgXcQ",
    );
    sqlite.close();
  });

  it("repairs malformed Invidious absolute URLs missing hostname", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.INVIDIOUS_BASE_URL = "http://192.168.1.11:3210";

    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/v1/videos/dQw4w9WgXcQ")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              videoId: "dQw4w9WgXcQ",
              title: "Malformed absolute URLs",
              dashUrl: "http://:3210/api/manifest/dash/id/dQw4w9WgXcQ",
              hlsUrl: "http://:3210/api/manifest/hls/playlist/dQw4w9WgXcQ",
              adaptiveFormats: [
                {
                  url: "http://:3210/videoplayback?id=abc",
                  type: "video/mp4",
                  qualityLabel: "720p",
                },
              ],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    const detail = await fetchVideoDetail(db, { videoId: "dQw4w9WgXcQ" });
    expect(detail.sourceUsed).toBe("invidious");
    expect(detail.dashUrl).toBe(
      "http://192.168.1.11:3210/api/manifest/dash/id/dQw4w9WgXcQ",
    );
    expect(detail.hlsUrl).toBe(
      "http://192.168.1.11:3210/api/manifest/hls/playlist/dQw4w9WgXcQ",
    );
    expect(detail.videoSources[0]?.url).toBe(
      "http://192.168.1.11:3210/videoplayback?id=abc",
    );
    sqlite.close();
  });

  it("rejects search when Invidious shares the same loopback port as Next", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "disabled";
    process.env.PORT = "3001";
    process.env.INVIDIOUS_BASE_URL = "http://127.0.0.1:3001";

    await expect(searchVideos(db, { q: "test", limit: 10 })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UpstreamUnavailableError &&
        /same loopback port|server fetch would hit OwnTube/i.test(err.message),
    );

    sqlite.close();
  });
});

describe("fetchChannelPage", () => {
  beforeEach(() => {
    resetRateLimiterForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("fetch not mocked for this test"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PIPED_BASE_URL;
    delete process.env.INVIDIOUS_BASE_URL;
  });

  it("falls back to Invidious when Piped channel has no relatedStreams", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("piped.test/channel/UCchan")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "UCchan",
              name: "Artist",
              relatedStreams: [],
            }),
          ),
        );
      }
      if (u.includes("inv.test/api/v1/channels/UCchan")) {
        if (u.includes("/videos")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                videos: [
                  {
                    type: "video",
                    videoId: "abcdefghijk",
                    title: "From Invidious uploads",
                    authorId: "UCchan",
                    author: "Artist",
                  },
                ],
              }),
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              authorId: "UCchan",
              author: "Artist",
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const page = await fetchChannelPage(db, { channelId: "UCchan" });
    expect(page.sourceUsed).toBe("invidious");
    expect(page.videos).toHaveLength(1);
    expect(page.videos[0]?.videoId).toBe("abcdefghijk");
    sqlite.close();
  });

  it("loads Piped channel uploads via search when relatedStreams is empty", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    delete process.env.INVIDIOUS_BASE_URL;

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("piped.test/channel/UCchan")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "UCchan",
              name: "Artist Channel",
              relatedStreams: [],
            }),
          ),
        );
      }
      if (u.includes("piped.test/search?")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                {
                  type: "stream",
                  url: "/watch?v=abcdefghijk",
                  title: "From Piped search",
                  uploaderUrl: "/channel/UCchan",
                  uploaderName: "Artist Channel",
                },
              ],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const page = await fetchChannelPage(db, { channelId: "UCchan" });
    expect(page.sourceUsed).toBe("piped");
    expect(page.videos).toHaveLength(1);
    expect(page.videos[0]?.title).toBe("From Piped search");
    sqlite.close();
  });

  it("loads Invidious channel uploads via RSS when /videos returns parse errors", async () => {
    const { db, sqlite } = createTestDb();
    delete process.env.PIPED_BASE_URL;
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("inv.test/api/v1/channels/UCchan")) {
        if (u.includes("/videos")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                videos: [
                  {
                    type: "parse-error",
                    errorMessage: "Missing hash key",
                  },
                ],
              }),
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              authorId: "UCchan",
              author: "Artist",
            }),
          ),
        );
      }
      if (u.includes("inv.test/feed/channel/UCchan")) {
        return Promise.resolve(
          new Response(
            `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>abcdefghijk</yt:videoId>
    <title>From RSS feed</title>
    <published>2026-05-23T12:00:00+00:00</published>
    <media:thumbnail url="https://inv.test/vi/abcdefghijk/mqdefault.jpg"/>
  </entry>
</feed>`,
            { headers: { "Content-Type": "application/atom+xml" } },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const page = await fetchChannelPage(db, { channelId: "UCchan" });
    expect(page.sourceUsed).toBe("invidious");
    expect(page.videos).toHaveLength(1);
    expect(page.videos[0]?.title).toBe("From RSS feed");
    sqlite.close();
  });

  it("falls back to Invidious when Piped hits process rate limit", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    let slot = 0;
    vi.spyOn(rateLimiter, "acquireUpstreamSlot").mockImplementation(() => {
      slot += 1;
      if (slot === 1) throw new RateLimitExceededError();
    });

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("inv.test/api/v1/channels/UCchan")) {
        if (u.includes("/videos")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                videos: [
                  {
                    type: "video",
                    videoId: "abcdefghijk",
                    title: "After rate limit",
                    authorId: "UCchan",
                    author: "Artist",
                  },
                ],
              }),
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ authorId: "UCchan", author: "Artist" }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const page = await fetchChannelPage(db, { channelId: "UCchan" });
    expect(page.sourceUsed).toBe("invidious");
    expect(page.videos[0]?.title).toBe("After rate limit");
    sqlite.close();
  });

  it("loads Piped channel shorts via the shorts tab", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    delete process.env.INVIDIOUS_BASE_URL;

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("piped.test/channel/UCchan")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "UCchan",
              name: "Artist",
              relatedStreams: [],
              tabs: [
                { name: "videos", data: "videos-tab" },
                { name: "shorts", data: "shorts-tab" },
              ],
            }),
          ),
        );
      }
      if (u.includes("piped.test/channels/tabs?") && u.includes("shorts-tab")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              relatedStreams: [
                {
                  type: "stream",
                  url: "/watch?v=shortvid11111",
                  title: "A short #shorts",
                  uploaderUrl: "/channel/UCchan",
                  duration: 45,
                  isShort: true,
                },
              ],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const page = await fetchChannelPage(db, {
      channelId: "UCchan",
      tab: "shorts",
    });
    expect(page.sourceUsed).toBe("piped");
    expect(page.videos).toHaveLength(1);
    expect(page.videos[0]?.title).toBe("A short #shorts");
    sqlite.close();
  });
});

describe("fetchTrendingVideos upstream fallback", () => {
  beforeEach(() => {
    resetRateLimiterForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("fetch not mocked for this test"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.PIPED_BASE_URL;
    delete process.env.INVIDIOUS_BASE_URL;
  });

  it("uses Invidious when Piped trending is empty", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("piped.test/trending")) {
        return Promise.resolve(new Response(JSON.stringify([])));
      }
      if (u.includes("inv.test/api/v1/trending")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                type: "video",
                videoId: "abcdefghijk",
                title: "Invidious trend",
                authorId: "UCx",
                author: "Ch",
              },
            ]),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const t = await fetchTrendingVideos(db, { region: "US", limit: 10 });
    expect(t.sourceUsed).toBe("invidious");
    expect(t.videos[0]?.videoId).toBe("abcdefghijk");
    sqlite.close();
  });

  it("throws rate limit only when both upstreams are throttled", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.spyOn(rateLimiter, "acquireUpstreamSlot").mockImplementation(() => {
      throw new RateLimitExceededError();
    });

    await expect(
      fetchTrendingVideos(db, { region: "US", limit: 5 }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    sqlite.close();
  });
});

describe("fetchVideoComments", () => {
  beforeEach(() => {
    resetRateLimiterForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("fetch not mocked for this test"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PIPED_BASE_URL;
    delete process.env.INVIDIOUS_BASE_URL;
  });

  it("returns unified comments from Piped-shaped JSON", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          comments: [
            {
              author: "Alice",
              commentId: "c1",
              commentText: "Great video!",
              commentedTime: "2 hours ago",
              commentorUrl: "/channel/UCalice",
              likeCount: 12,
              pinned: true,
              thumbnail: "https://piped.test/avatar.jpg",
            },
          ],
          disabled: false,
          nextpage: "token-abc",
        }),
      ),
    );

    const r = await fetchVideoComments(db, {
      videoId: "dQw4w9WgXcQ",
      sortBy: "top",
    });
    expect(r.sourceUsed).toBe("piped");
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]?.author).toBe("Alice");
    expect(r.comments[0]?.authorId).toBe("UCalice");
    expect(r.comments[0]?.isPinned).toBe(true);
    expect(r.continuation).toBe("token-abc");
    sqlite.close();
  });

  it("keeps Invidious contentHtml for timestamp anchor parsing", async () => {
    const { db, sqlite } = createTestDb();
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          videoId: "cHocYnA_JVY",
          comments: [
            {
              author: "Viewer",
              authorId: "UCx",
              commentId: "iv-ts",
              content: "fallback plain",
              contentHtml:
                '<a href="https://www.youtube.com/watch?v=cHocYnA_JVY&amp;t=102">1:42</a> Jim: NO',
              publishedText: "1 hour ago",
              likeCount: 1,
              authorThumbnails: [],
            },
          ],
        }),
      ),
    );

    const r = await fetchVideoComments(db, {
      videoId: "cHocYnA_JVY",
      sortBy: "top",
    });
    expect(r.comments[0]?.text).toContain(
      'href="https://www.youtube.com/watch?v=cHocYnA_JVY&amp;t=102"',
    );
    expect(r.comments[0]?.text).toContain("1:42");
    sqlite.close();
  });

  it("falls back to Invidious when Piped comments fail", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";
    process.env.INVIDIOUS_BASE_URL = "https://inv.test";

    vi.mocked(fetch).mockImplementation((input) => {
      const u = String(input);
      if (u.includes("piped.test/comments/")) {
        return Promise.resolve(new Response("error", { status: 500 }));
      }
      if (u.includes("inv.test/api/v1/comments/")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              videoId: "dQw4w9WgXcQ",
              commentCount: 1,
              comments: [
                {
                  author: "Bob",
                  authorId: "UCbob",
                  commentId: "iv1",
                  content: "Nice!",
                  publishedText: "1 day ago",
                  likeCount: 3,
                  authorThumbnails: [
                    { url: "/ggpht/avatar", width: 48, height: 48 },
                  ],
                },
              ],
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    const r = await fetchVideoComments(db, {
      videoId: "dQw4w9WgXcQ",
      sortBy: "top",
    });
    expect(r.sourceUsed).toBe("invidious");
    expect(r.comments[0]?.author).toBe("Bob");
    expect(r.comments[0]?.authorAvatarUrl).toBe(
      "https://inv.test/ggpht/avatar",
    );
    sqlite.close();
  });

  it("reports disabled comments from Piped", async () => {
    const { db, sqlite } = createTestDb();
    process.env.PIPED_BASE_URL = "https://piped.test";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          comments: [],
          disabled: true,
          nextpage: "",
        }),
      ),
    );

    const r = await fetchVideoComments(db, {
      videoId: "dQw4w9WgXcQ",
      sortBy: "top",
    });
    expect(r.disabled).toBe(true);
    expect(r.comments).toHaveLength(0);
    sqlite.close();
  });
});
