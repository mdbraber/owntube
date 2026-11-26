import { afterEach, describe, expect, it, vi } from "vitest";
import { ANON_VIEWER_COOKIE, createAnonViewer } from "@/server/anon-viewer";
import * as shortsFeed from "@/server/recommendation/shorts-feed";
import { loadAnonShortSeenVideoIds } from "@/server/recommendation/shorts-seen";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("shortsRouter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards the shelf purpose to the recommendation service", async () => {
    const { db, sqlite } = createTestDb();
    const fetchShortsFeedForViewer = vi
      .spyOn(shortsFeed, "fetchShortsFeedForViewer")
      .mockResolvedValue({
        videos: [],
        continuation: null,
      });
    const caller = appRouter.createCaller({ db, userId: null });

    await caller.shorts.feed({ region: "FR", limit: 18, purpose: "shelf" });

    expect(fetchShortsFeedForViewer).toHaveBeenCalledWith(
      db,
      null,
      expect.objectContaining({ purpose: "shelf" }),
      null,
    );
    sqlite.close();
  });

  it("mints one anonymous id per request and records seen shorts under it", async () => {
    const { db, sqlite } = createTestDb();
    const resHeaders = new Headers();
    const anon = createAnonViewer(
      new Request("https://owntube.test/api/trpc/shorts.markSeen"),
      resHeaders,
    );
    const caller = appRouter.createCaller({ db, userId: null, anon });

    await caller.shorts.markSeen({ videoId: "aaaaaaaaaaa", channelId: "UC1" });
    await caller.shorts.markSeen({ videoId: "bbbbbbbbbbb", channelId: "UC1" });

    const cookies = resHeaders.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(
      new RegExp(`^${ANON_VIEWER_COOKIE}=[A-Za-z0-9_-]{22};.*HttpOnly.*Secure`),
    );
    expect(anon.id).not.toBeNull();
    expect(loadAnonShortSeenVideoIds(db, anon.id as string)).toEqual(
      new Set(["aaaaaaaaaaa", "bbbbbbbbbbb"]),
    );
    sqlite.close();
  });

  it("passes the anonymous cookie id to the feed for signed-out viewers", async () => {
    const { db, sqlite } = createTestDb();
    const fetchShortsFeedForViewer = vi
      .spyOn(shortsFeed, "fetchShortsFeedForViewer")
      .mockResolvedValue({
        videos: [],
        continuation: null,
      });
    const id = "abcdefghijklmnopqrstuv";
    const anon = createAnonViewer(
      new Request("http://owntube.test/api/trpc/shorts.feed", {
        headers: { cookie: `other=1; ${ANON_VIEWER_COOKIE}=${id}` },
      }),
      new Headers(),
    );
    const caller = appRouter.createCaller({ db, userId: null, anon });

    await caller.shorts.feed({ region: "FR" });

    expect(fetchShortsFeedForViewer).toHaveBeenCalledWith(
      db,
      null,
      expect.anything(),
      id,
    );
    sqlite.close();
  });
});
