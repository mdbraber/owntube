import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRssInFlight,
  type RssEntry,
  refreshChannelRss,
} from "@/server/rss/cache";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import {
  dropMembersOnlyVideos,
  isLikelyMembersOnly,
  MEMBERS_ONLY_GRACE_SEC,
} from "@/server/subscriptions/members-only";
import { createTestDb } from "@/test/db";

const CHANNEL = "UCabcdefghijklmnopqrstuv";
const DAY = 24 * 60 * 60;
/** Fixed "fetched at" for the pure cases; published times are relative to it. */
const FETCHED = 1_790_000_000;

function video(
  over: Partial<UnifiedVideo> & { videoId: string },
): UnifiedVideo {
  return { title: over.videoId, channelId: CHANNEL, ...over };
}

function entry(videoId: string, publishedAt: number): RssEntry {
  return {
    videoId,
    title: videoId,
    channelId: CHANNEL,
    thumbnailUrl: "",
    publishedAt,
  };
}

/** A feed of two public uploads, a week and a month before the fetch. */
function snapshot(fetchedAt = FETCHED) {
  return {
    entries: [
      entry("publicNewer", FETCHED - 7 * DAY),
      entry("publicOlder", FETCHED - 30 * DAY),
    ],
    fetchedAt,
  };
}

describe("isLikelyMembersOnly", () => {
  it("flags a zero-view video the feed skipped, inside its window", () => {
    const v = video({
      videoId: "membersOnly",
      viewCount: 0,
      publishedAt: FETCHED - 14 * DAY,
    });
    expect(isLikelyMembersOnly(v, snapshot())).toBe(true);
  });

  it("flags the channel's newest upload too, if the feed was fetched after it", () => {
    // The case that prompted this: members-only as the latest upload is newer
    // than everything in the feed, so only the fetch time can tell it apart.
    const v = video({
      videoId: "membersOnly",
      viewCount: 0,
      publishedAt: FETCHED - DAY,
    });
    expect(isLikelyMembersOnly(v, snapshot())).toBe(true);
  });

  it("treats a missing view count like zero", () => {
    const v = video({ videoId: "membersOnly", publishedAt: FETCHED - DAY });
    expect(isLikelyMembersOnly(v, snapshot())).toBe(true);
  });

  it("keeps a video that is in the feed", () => {
    const v = video({
      videoId: "publicNewer",
      viewCount: 0,
      publishedAt: FETCHED - 7 * DAY,
    });
    expect(isLikelyMembersOnly(v, snapshot())).toBe(false);
  });

  it("keeps a video with views", () => {
    const v = video({
      videoId: "notInFeed",
      viewCount: 12,
      publishedAt: FETCHED - DAY,
    });
    expect(isLikelyMembersOnly(v, snapshot())).toBe(false);
  });

  it("keeps an upload the feed may not have caught up with yet", () => {
    const v = video({
      videoId: "brandNew",
      viewCount: 0,
      publishedAt: FETCHED - MEMBERS_ONLY_GRACE_SEC + 60,
    });
    expect(isLikelyMembersOnly(v, snapshot())).toBe(false);
  });

  it("keeps an upload published after the feed was fetched", () => {
    const v = video({
      videoId: "afterFetch",
      viewCount: 0,
      publishedAt: FETCHED + DAY,
    });
    expect(isLikelyMembersOnly(v, snapshot())).toBe(false);
  });

  it("keeps a video older than the feed's window — it may have scrolled out", () => {
    const v = video({
      videoId: "ancient",
      viewCount: 0,
      publishedAt: FETCHED - 365 * DAY,
    });
    expect(isLikelyMembersOnly(v, snapshot())).toBe(false);
  });

  it("keeps live and upcoming streams", () => {
    const base = { viewCount: 0, publishedAt: FETCHED - DAY };
    expect(
      isLikelyMembersOnly(
        video({ videoId: "l", isLive: true, ...base }),
        snapshot(),
      ),
    ).toBe(false);
    expect(
      isLikelyMembersOnly(
        video({ videoId: "u", isUpcoming: true, ...base }),
        snapshot(),
      ),
    ).toBe(false);
  });

  it("keeps everything when there is no feed to judge by", () => {
    const v = video({ videoId: "x", viewCount: 0, publishedAt: FETCHED - DAY });
    expect(isLikelyMembersOnly(v, null)).toBe(false);
    expect(isLikelyMembersOnly(v, { entries: [], fetchedAt: FETCHED })).toBe(
      false,
    );
  });

  it("keeps a video without a publish time", () => {
    const v = video({ videoId: "undated", viewCount: 0 });
    expect(isLikelyMembersOnly(v, snapshot())).toBe(false);
  });
});

describe("dropMembersOnlyVideos", () => {
  beforeEach(() => clearRssInFlight());
  afterEach(() => vi.unstubAllGlobals());

  it("drops the skipped zero-view upload using the cached feed, and nothing else", async () => {
    const { db, sqlite } = createTestDb();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<?xml version="1.0"?><feed>
              <entry><yt:videoId>publicNewer</yt:videoId><title>a</title>
                <published>2026-07-20T00:00:00Z</published></entry>
              <entry><yt:videoId>publicOlder</yt:videoId><title>b</title>
                <published>2026-07-01T00:00:00Z</published></entry>
            </feed>`,
            { status: 200 },
          ),
      ),
    );
    await refreshChannelRss(db, CHANNEL); // caches the feed, fetched "now"

    const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
    const page = [
      video({
        videoId: "publicNewer",
        viewCount: 900,
        publishedAt: at("2026-07-20T00:00:00Z"),
      }),
      video({
        videoId: "membersOnly",
        viewCount: 0,
        publishedAt: at("2026-07-10T00:00:00Z"),
      }),
      video({
        videoId: "publicOlder",
        viewCount: 400,
        publishedAt: at("2026-07-01T00:00:00Z"),
      }),
    ];

    expect(dropMembersOnlyVideos(db, page).map((v) => v.videoId)).toEqual([
      "publicNewer",
      "publicOlder",
    ]);
    sqlite.close();
  });

  it("keeps a channel's videos when its feed was never cached", () => {
    const { db, sqlite } = createTestDb();
    const page = [
      video({ videoId: "x", viewCount: 0, publishedAt: FETCHED - DAY }),
    ];
    expect(dropMembersOnlyVideos(db, page)).toEqual(page);
    sqlite.close();
  });
});
