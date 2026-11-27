import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseLibraryQuery } from "@/lib/library-query";
import {
  channelTags,
  interactions,
  playlistItems,
  playlists,
  subscriptions,
  users,
  videoCache,
  videoMemos,
  watchHistory,
  watchQueue,
} from "@/server/db/schema";
import { searchLibrary } from "@/server/search/library-search";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

const summaryCalls = vi.hoisted(() => ({ opts: [] as unknown[] }));

// The gateway's cache knows one playlist video the tables don't describe.
vi.mock("@/server/catalog", () => ({
  fetchVideoSummaries: async (ids: readonly string[], opts: unknown) => {
    summaryCalls.opts.push(opts);
    const known = new Map([
      [
        "plItem00001",
        {
          videoId: "plItem00001",
          title: "Road trip mix",
          channelId: JAZZ,
          channelName: "Jazz Channel",
          durationSeconds: 600,
        },
      ],
    ]);
    return new Map(
      ids.flatMap((id) => (known.has(id) ? [[id, known.get(id)]] : [])),
    );
  },
  searchVideos: async () => {
    throw new Error("library search must not search YouTube");
  },
}));

const MUSIC = "UCmusicfav00000000000000";
const JAZZ = "UCjazz000000000000000000";
const PODCAST = "UCpodcast000000000000000";
const OTHER = "UCother00000000000000000";

const { db, sqlite } = createTestDb();
afterAll(() => sqlite.close());

function makeUser(email: string) {
  return db
    .insert(users)
    .values({ email, passwordHash: "x", createdAt: 1, updatedAt: 1 })
    .returning({ id: users.id })
    .get();
}
const me = makeUser("lib@example.com");
const someoneElse = makeUser("lib-other@example.com");
const caller = appRouter.createCaller({ db, userId: me.id });

function rss(channelId: string, channelName: string, entries: object[]) {
  db.insert(videoCache)
    .values({
      cacheKey: `rss:v1:${channelId}`,
      source: "youtube",
      kind: "rss",
      payloadJson: JSON.stringify({
        entries: entries.map((e) => ({
          channelId,
          channelName,
          thumbnailUrl: "https://i.ytimg.com/vi/x/hqdefault.jpg",
          ...e,
        })),
      }),
      fetchedAt: 1,
      // Long expired: the library reads stale rows too.
      expiresAt: 2,
    })
    .run();
}

beforeAll(() => {
  const uid = me.id;
  for (const channelId of [MUSIC, JAZZ]) {
    db.insert(subscriptions)
      .values({ userId: uid, channelId, subscribedAt: 1 })
      .run();
  }
  for (const [channelId, tag] of [
    [MUSIC, "music"],
    [MUSIC, "favorite"],
    [JAZZ, "jazz"],
    [PODCAST, "podcast"],
  ] as const) {
    db.insert(channelTags)
      .values({ userId: uid, channelId, tag, createdAt: 1 })
      .run();
  }
  rss(MUSIC, "Music Channel", [
    { videoId: "musicNew001", title: "New single", publishedAt: 3000 },
    { videoId: "musicOld001", title: "Old single", publishedAt: 1000 },
  ]);
  rss(JAZZ, "Jazz Channel", [
    { videoId: "jazzVid0001", title: "Late night set", publishedAt: 2000 },
  ]);
  rss(PODCAST, "Pod Channel", [
    { videoId: "podVid00001", title: "Episode 12", publishedAt: 2500 },
  ]);
  db.insert(watchHistory)
    .values([
      {
        userId: uid,
        videoId: "musicOld001",
        channelId: MUSIC,
        startedAt: 5000,
        createdAt: 5000,
        videoTitle: "Old single",
        channelName: "Music Channel",
      },
      {
        userId: uid,
        videoId: "randomHist1",
        channelId: OTHER,
        startedAt: 4000,
        createdAt: 4000,
        videoTitle: "Random café vlog",
        channelName: "Other Channel",
      },
    ])
    .run();
  db.insert(interactions)
    .values({
      userId: uid,
      videoId: "savedVid001",
      channelId: MUSIC,
      type: "save",
      createdAt: 1500,
      title: "Saved thing",
    })
    .run();
  db.insert(watchQueue)
    .values({
      userId: uid,
      videoId: "jazzVid0001",
      title: "Late night set",
      channelId: JAZZ,
      position: 0,
      addedAt: 100,
    })
    .run();
  const list = db
    .insert(playlists)
    .values({ userId: uid, name: "Road Trip", createdAt: 1, updatedAt: 1 })
    .returning({ id: playlists.id })
    .get();
  db.insert(playlistItems)
    .values({ playlistId: list.id, videoId: "plItem00001", addedAt: 100 })
    .run();
  const memo = {
    createdAt: 1,
    updatedAt: 1,
    sourceKind: "direct",
  };
  db.insert(videoMemos)
    .values([
      {
        ...memo,
        userId: uid,
        videoId: "jazzVid0001",
        channelId: JAZZ,
        text: "Anna: great solo at 2:10",
        occurredAt: 6000,
      },
      {
        ...memo,
        userId: uid,
        videoId: "memoOnly001",
        text: "Shared in #design",
        occurredAt: 500,
        videoTitle: "Memo-only video",
        channelName: "Somebody",
      },
      {
        ...memo,
        userId: someoneElse.id,
        videoId: "musicNew001",
        text: "not mine",
        occurredAt: 1,
      },
    ])
    .run();
});

async function ids(q: string): Promise<string[]> {
  return (await caller.search.library({ q })).videos.map((v) => v.videoId);
}

describe("library search", () => {
  it("has:memo finds videos with the user's memos only", async () => {
    // jazz by upload date (2000), the memo-only one by its memo (500).
    expect(await ids("has:memo")).toEqual(["jazzVid0001", "memoOnly001"]);
    const res = await caller.search.library({ q: "has:memo" });
    expect(res.videos[1]).toMatchObject({
      title: "Memo-only video",
      channelName: "Somebody",
    });
  });

  it("in:favorites tag:music narrows to both", async () => {
    expect(await ids("in:favorites tag:music")).toEqual([
      "musicNew001",
      "savedVid001",
      "musicOld001",
    ]);
  });

  it("-in:history leaves out watched videos", async () => {
    expect(await ids("in:favorites tag:music -in:history")).toEqual([
      "musicNew001",
      "savedVid001",
    ]);
  });

  it("tag:music OR tag:jazz takes either, playlist videos too", async () => {
    expect(await ids("tag:music OR tag:jazz")).toEqual([
      "musicNew001",
      "jazzVid0001",
      "savedVid001",
      "musicOld001",
      "plItem00001",
    ]);
    // Only the gateway's cache was asked, never YouTube.
    expect(
      summaryCalls.opts.every((o) => JSON.stringify(o) === '{"cache":"only"}'),
    ).toBe(true);
  });

  it("matches words in titles, channel names and memos, accents folded", async () => {
    expect(await ids("in:history cafe")).toEqual(["randomHist1"]);
    expect(await ids("has:memo SOLO")).toEqual(["jazzVid0001"]);
    expect(await ids('tag:jazz "road trip"')).toEqual(["plItem00001"]);
    expect(await ids("tag:music -single")).toEqual(["savedVid001"]);
  });

  it("knows places: subscriptions, saved, queue, playlists", async () => {
    expect(await ids("in:subscriptions -tag:music")).toEqual([
      "jazzVid0001",
      "plItem00001",
    ]);
    expect(await ids("in:saved")).toEqual(["savedVid001"]);
    expect(await ids("in:queue")).toEqual(["jazzVid0001"]);
    expect(await ids('in:playlist:"road trip"')).toEqual(["plItem00001"]);
    // The vlog by when it was watched (4000), the episode by upload (2500).
    expect(await ids("-has:memo -in:subscriptions")).toEqual([
      "randomHist1",
      "podVid00001",
    ]);
  });

  it("says when a tag or playlist matches nothing", async () => {
    const res = await caller.search.library({ q: "tag:nothere" });
    expect(res.total).toBe(0);
    expect(res.notices).toEqual(["No channels are tagged #nothere."]);
    expect(
      (await caller.search.library({ q: 'in:playlist:"Nope"' })).notices,
    ).toEqual(["You have no playlist named “Nope”."]);
    // Negated, it isn't worth a notice.
    expect(
      (await caller.search.library({ q: "has:memo -tag:nothere" })).notices,
    ).toEqual([]);
  });

  it("follows the favorite tag setting for in:favorites", async () => {
    await caller.settings.update({ favoriteTag: "podcast" });
    try {
      const res = await caller.search.library({ q: "in:favorites" });
      expect(res.videos.map((v) => v.videoId)).toEqual(["podVid00001"]);
      expect(res.filters[0]?.label).toBe("in:favorites · #podcast");
      expect(await ids("tag:favorite")).toEqual([
        "musicNew001",
        "savedVid001",
        "musicOld001",
      ]);
    } finally {
      await caller.settings.update({ favoriteTag: "favorite" });
    }
  });

  it("paginates newest first", async () => {
    const parsed = parseLibraryQuery("tag:music OR tag:jazz", {
      favoriteTag: "favorite",
    });
    if (parsed.kind !== "library") throw new Error("parse");
    const page2 = await searchLibrary(db, me.id, parsed, {
      page: 2,
      pageSize: 2,
    });
    expect(page2.total).toBe(5);
    expect(page2.videos.map((v) => v.videoId)).toEqual([
      "savedVid001",
      "musicOld001",
    ]);
  });

  it("refuses plain queries, bad filters and signed-out callers", async () => {
    await expect(
      caller.search.library({ q: "just words" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.search.library({ q: "has:foo" })).rejects.toMatchObject(
      {
        code: "BAD_REQUEST",
        message: "Unknown filter has:foo. Try has:memo.",
      },
    );
    const anon = appRouter.createCaller({ db, userId: null });
    await expect(anon.search.library({ q: "has:memo" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("offers the user's tags and playlists as suggestions", async () => {
    expect(await caller.search.libraryVocabulary()).toEqual({
      favoriteTag: "favorite",
      tags: [
        { tag: "favorite", count: 1 },
        { tag: "jazz", count: 1 },
        { tag: "music", count: 1 },
        { tag: "podcast", count: 1 },
      ],
      playlists: [{ id: expect.any(Number), name: "Road Trip" }],
    });
  });
});
