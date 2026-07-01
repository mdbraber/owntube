import { describe, expect, it } from "vitest";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import {
  coercePublishedSecondsFromUpstream,
  compareSubscriptionHeads,
  mergeVideosByIdPreferNewer,
  mergeVideosNewestFirst,
  parseRelativePublishedToUnix,
  pickNewestVideoPerChannel,
  publishedSortKey,
  sortVideosNewestFirst,
  takeNewestVideos,
} from "./published-sort-key";

describe("parseRelativePublishedToUnix", () => {
  it("parses English ago", () => {
    const now = 1_700_000_000;
    expect(parseRelativePublishedToUnix("2 hours ago", now)).toBe(now - 7200);
    expect(parseRelativePublishedToUnix("Streamed 3 days ago", now)).toBe(
      now - 3 * 86400,
    );
  });

  it("parses French il y a", () => {
    const now = 1_700_000_000;
    expect(parseRelativePublishedToUnix("il y a 5 minutes", now)).toBe(
      now - 300,
    );
  });
});

describe("publishedSortKey", () => {
  it("uses publishedAt when set", () => {
    const v: UnifiedVideo = {
      videoId: "abc",
      title: "t",
      publishedAt: 1_699_999_000,
    };
    expect(publishedSortKey(v)).toBe(1_699_999_000);
  });

  it("falls back to publishedText when publishedAt is not a real unix timestamp", () => {
    const now = 1_700_000_000;
    const v: UnifiedVideo = {
      videoId: "abc",
      title: "t",
      publishedAt: 3_600,
      publishedText: "14 hours ago",
    };
    expect(publishedSortKey(v, now)).toBe(now - 14 * 3600);
  });
});

describe("coercePublishedSecondsFromUpstream", () => {
  it("rejects tiny numeric values that are not plausible unix timestamps", () => {
    expect(coercePublishedSecondsFromUpstream(3_600)).toBeUndefined();
  });
});

describe("takeNewestVideos", () => {
  it("returns the newest rows by publishedSortKey, not upstream order", () => {
    const now = 1_700_000_000;
    const rows: UnifiedVideo[] = [
      { videoId: "old", title: "old", publishedText: "30 days ago" },
      { videoId: "mid", title: "mid", publishedText: "5 days ago" },
      { videoId: "new", title: "new", publishedText: "2 hours ago" },
    ];
    expect(takeNewestVideos(rows, 2, now).map((v) => v.videoId)).toEqual([
      "new",
      "mid",
    ]);
  });
});

describe("sortVideosNewestFirst", () => {
  it("orders by release date descending", () => {
    const now = 1_700_000_000;
    const rows: UnifiedVideo[] = [
      { videoId: "b", title: "b", publishedText: "10 days ago" },
      { videoId: "a", title: "a", publishedText: "1 hour ago" },
      { videoId: "c", title: "c", publishedAt: now - 86400 },
    ];
    expect(sortVideosNewestFirst(rows, now).map((v) => v.videoId)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
});

describe("mergeVideosNewestFirst", () => {
  it("dedupes pages and sorts newest first", () => {
    const now = 1_700_000_000;
    const page1: UnifiedVideo[] = [
      { videoId: "x", title: "x", publishedText: "2 days ago" },
      { videoId: "y", title: "y", publishedText: "1 week ago" },
    ];
    const page2: UnifiedVideo[] = [
      { videoId: "z", title: "z", publishedText: "3 hours ago" },
      { videoId: "x", title: "x newer", publishedText: "1 hour ago" },
    ];
    expect(
      mergeVideosNewestFirst([page1, page2], now).map((v) => v.videoId),
    ).toEqual(["x", "z", "y"]);
  });
});

describe("mergeVideosByIdPreferNewer", () => {
  it("keeps the row with a higher publishedSortKey on duplicate videoId", () => {
    const now = 1_700_000_000;
    const stale: UnifiedVideo = {
      videoId: "dup",
      title: "stale",
      publishedText: "1 year ago",
    };
    const fresh: UnifiedVideo = {
      videoId: "dup",
      title: "fresh",
      publishedAt: now - 3600,
    };
    const { byId } = mergeVideosByIdPreferNewer(
      [
        { video: stale, source: "trending" },
        { video: fresh, source: "history_channel:UCx" },
      ],
      now,
    );
    expect(byId.get("dup")?.title).toBe("fresh");
  });

  it("on equal dates prefers channel-page source over trending", () => {
    const now = 1_700_000_000;
    const trendingRow: UnifiedVideo = {
      videoId: "dup",
      title: "from trending",
      publishedText: "1 day ago",
    };
    const channelRow: UnifiedVideo = {
      videoId: "dup",
      title: "from channel page",
      publishedText: "1 day ago",
    };
    const { byId } = mergeVideosByIdPreferNewer(
      [
        { video: trendingRow, source: "trending" },
        { video: channelRow, source: "history_channel:UCy" },
      ],
      now,
    );
    expect(byId.get("dup")?.title).toBe("from channel page");
  });
});

describe("pickNewestVideoPerChannel", () => {
  it("with maxPerChannel 1 keeps only the newest upload per channel", () => {
    const now = 1_700_000_000;
    const ch = "UCamixem";
    const old: UnifiedVideo = {
      videoId: "old",
      title: "Old",
      channelId: ch,
      publishedText: "2 months ago",
    };
    const recent: UnifiedVideo = {
      videoId: "new",
      title: "New",
      channelId: ch,
      publishedText: "1 hour ago",
    };
    const picked = pickNewestVideoPerChannel([old, recent], {
      nowSec: now,
      maxPerChannel: 1,
    });
    expect(picked).toHaveLength(1);
    expect(picked[0]?.videoId).toBe("new");
  });

  it("default keeps up to maxPerChannel newest per channel", () => {
    const now = 1_700_000_000;
    const ch = "UCx";
    const rows: UnifiedVideo[] = Array.from({ length: 14 }, (_, i) => ({
      videoId: `v${i}`,
      title: `t${i}`,
      channelId: ch,
      publishedText: `${i + 1} days ago`,
    }));
    const picked = pickNewestVideoPerChannel(rows, { nowSec: now });
    expect(picked).toHaveLength(10);
    expect(picked.map((v) => v.videoId)).toContain("v0");
    expect(picked.map((v) => v.videoId)).not.toContain("v13");
  });

  it("keeps every video that has no channelId", () => {
    const a: UnifiedVideo = { videoId: "a", title: "a" };
    const b: UnifiedVideo = { videoId: "b", title: "b" };
    expect(pickNewestVideoPerChannel([a, b])).toHaveLength(2);
  });
});

describe("compareSubscriptionHeads", () => {
  it("prefers another channel when timestamps tie", () => {
    const now = 1_700_000_000;
    const a = {
      subscriptionChannelId: "UCaaa",
      v: {
        videoId: "v1",
        title: "a",
        publishedText: "1 day ago",
      } as UnifiedVideo,
    };
    const b = {
      subscriptionChannelId: "UCbbb",
      v: {
        videoId: "v2",
        title: "b",
        publishedText: "1 day ago",
      } as UnifiedVideo,
    };
    const last = "UCaaa";
    expect(compareSubscriptionHeads(a, b, last, now)).toBeGreaterThan(0);
    expect(compareSubscriptionHeads(b, a, last, now)).toBeLessThan(0);
  });
});
