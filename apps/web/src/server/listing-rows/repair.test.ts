import { describe, expect, it, vi } from "vitest";
import { UpstreamVideoUnavailableError } from "@/server/errors/upstream-video-unavailable";
import {
  MAX_LOOKUPS_PER_LISTING,
  type RepairDeps,
  repairListingRows,
} from "@/server/listing-rows/repair";
import type { RssEntry } from "@/server/rss/cache";
import type { UnifiedVideo, VideoDetail } from "@/server/services/proxy.types";
import { createTestDb } from "@/test/db";

const CHANNEL = "UCabcdefghijklmnopqrstuv";
const NOW = Math.floor(Date.now() / 1000);
const WEEK_AGO = NOW - 7 * 24 * 3600;
const REAL_DATE = NOW - 150 * 24 * 3600;

function row(over: Partial<UnifiedVideo> & { videoId: string }): UnifiedVideo {
  return { title: over.videoId, channelId: CHANNEL, ...over };
}

function rssEntry(over: Partial<RssEntry> & { videoId: string }): RssEntry {
  return { title: over.videoId, channelId: CHANNEL, ...over } as RssEntry;
}

function deps(over: Partial<RepairDeps> = {}): RepairDeps {
  return {
    rssEntries: vi.fn(async () => []),
    videoDetail: vi.fn(async (): Promise<VideoDetail> => {
      throw new Error("unexpected lookup");
    }),
    ...over,
  };
}

const membersOnly = () =>
  Promise.reject(
    new UpstreamVideoUnavailableError(
      "Join this channel to get access to members-only content like this video, and other exclusive perks.",
    ),
  );

describe("repairListingRows", () => {
  it("takes the date and count of a broken row from the RSS, without a lookup", async () => {
    const { db } = createTestDb();
    const d = deps({
      rssEntries: async () => [
        rssEntry({
          videoId: "Iq34gq2ihMk",
          publishedAt: REAL_DATE,
          viewCount: 449214,
          channelName: "Chan",
        }),
      ],
    });
    const [out] = await repairListingRows(
      db,
      CHANNEL,
      [
        row({
          videoId: "Iq34gq2ihMk",
          viewCount: 0,
          publishedAt: NOW,
          publishedText: "0 seconds ago",
        }),
      ],
      d,
    );
    expect(out).toMatchObject({
      publishedAt: REAL_DATE,
      viewCount: 449214,
      channelName: "Chan",
    });
    expect(d.videoDetail).not.toHaveBeenCalled();
  });

  it("keeps a real listing count over the RSS one", async () => {
    const { db } = createTestDb();
    const [out] = await repairListingRows(
      db,
      CHANNEL,
      [row({ videoId: "aaaaaaaaaaa", viewCount: 500, publishedAt: WEEK_AGO })],
      deps({
        rssEntries: async () => [
          rssEntry({ videoId: "aaaaaaaaaaa", viewCount: 400 }),
        ],
      }),
    );
    expect(out.viewCount).toBe(500);
  });

  it("repairs an older broken row from the single-video endpoint", async () => {
    const { db } = createTestDb();
    const d = deps({
      videoDetail: vi.fn(
        async () =>
          ({
            videoId: "yUM_QMlRXX8",
            publishedAt: REAL_DATE,
            viewCount: 364000,
          }) as VideoDetail,
      ),
    });
    const [out] = await repairListingRows(
      db,
      CHANNEL,
      [
        row({
          videoId: "yUM_QMlRXX8",
          viewCount: 0,
          publishedAt: NOW,
          publishedText: "0 seconds ago",
        }),
      ],
      d,
    );
    expect(out).toMatchObject({ publishedAt: REAL_DATE, viewCount: 364000 });
  });

  it("drops a row YouTube refuses as members-only, and keeps the others", async () => {
    const { db } = createTestDb();
    const out = await repairListingRows(
      db,
      CHANNEL,
      [
        row({ videoId: "membersOnly", viewCount: 0, publishedAt: WEEK_AGO }),
        row({ videoId: "publicVideo", viewCount: 10, publishedAt: WEEK_AGO }),
      ],
      deps({ videoDetail: membersOnly }),
    );
    expect(out.map((v) => v.videoId)).toEqual(["publicVideo"]);
  });

  it("keeps a row whose lookup fails for any other reason", async () => {
    const { db } = createTestDb();
    const out = await repairListingRows(
      db,
      CHANNEL,
      [row({ videoId: "zeroViews01", viewCount: 0, publishedAt: WEEK_AGO })],
      deps({
        videoDetail: () => Promise.reject(new Error("rate limited")),
      }),
    );
    expect(out.map((v) => v.videoId)).toEqual(["zeroViews01"]);
  });

  it("never looks up live or upcoming rows", async () => {
    const { db } = createTestDb();
    const d = deps();
    const out = await repairListingRows(
      db,
      CHANNEL,
      [
        row({ videoId: "liveNow0001", viewCount: 0, isLive: true }),
        row({ videoId: "premiere001", viewCount: 0, isUpcoming: true }),
      ],
      d,
    );
    expect(out).toHaveLength(2);
    expect(d.videoDetail).not.toHaveBeenCalled();
  });

  it("remembers each outcome, so the next refresh asks nothing upstream", async () => {
    const { db } = createTestDb();
    const rows = [
      row({ videoId: "membersOnly", viewCount: 0, publishedAt: WEEK_AGO }),
      row({ videoId: "flakyVideo0", viewCount: 0, publishedAt: WEEK_AGO }),
    ];
    const first = vi.fn((_db: unknown, id: string) =>
      id === "membersOnly"
        ? membersOnly()
        : Promise.reject(new Error("upstream down")),
    );
    await repairListingRows(db, CHANNEL, rows, deps({ videoDetail: first }));
    expect(first).toHaveBeenCalledTimes(2);

    const second = vi.fn();
    const out = await repairListingRows(
      db,
      CHANNEL,
      rows,
      deps({ videoDetail: second }),
    );
    expect(second).not.toHaveBeenCalled();
    expect(out.map((v) => v.videoId)).toEqual(["flakyVideo0"]);
  });

  it("caps lookups per listing", async () => {
    const { db } = createTestDb();
    const rows = Array.from({ length: MAX_LOOKUPS_PER_LISTING + 4 }, (_, i) =>
      row({
        videoId: `zero${String(i).padStart(7, "0")}`,
        viewCount: 0,
        publishedAt: WEEK_AGO,
      }),
    );
    const d = deps({ videoDetail: vi.fn(membersOnly) });
    const out = await repairListingRows(db, CHANNEL, rows, d);
    expect(d.videoDetail).toHaveBeenCalledTimes(MAX_LOOKUPS_PER_LISTING);
    // The rest stay as listed until a later refresh gets to them.
    expect(out).toHaveLength(4);
  });
});
