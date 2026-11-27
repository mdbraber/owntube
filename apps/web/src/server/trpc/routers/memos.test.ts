import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_TOKEN_SCOPE_KEYS,
  API_TOKEN_SCOPES,
  apiTokenAllows,
} from "@/server/api-token";
import { playlistItems, users, videoMemos } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

const lookups = vi.hoisted(() => ({ calls: [] as string[][] }));

// The memo row stores the video's title; the real lookup goes to the gateway.
vi.mock("@/server/catalog", () => ({
  fetchVideoSummaries: async (ids: readonly string[]) => {
    lookups.calls.push([...ids]);
    return new Map(
      ids.map((id) => [
        id,
        {
          videoId: id,
          title: `Title of ${id}`,
          channelId: "UCfromlookup000000000000",
          channelName: "Looked-up channel",
        },
      ]),
    );
  },
}));

const { db, sqlite } = createTestDb();
afterAll(() => sqlite.close());

const ts = Math.floor(Date.now() / 1000);
function makeUser(email: string) {
  return db
    .insert(users)
    .values({ email, passwordHash: "x", createdAt: ts, updatedAt: ts })
    .returning({ id: users.id })
    .get();
}

const alice = makeUser("memo-alice@example.com");
const bob = makeUser("memo-bob@example.com");
const asAlice = appRouter.createCaller({ db, userId: alice.id });
const asBob = appRouter.createCaller({ db, userId: bob.id });

const VIDEO = "dQw4w9WgXcQ";
const OTHER_VIDEO = "9bZkp7q19f0";
const SLACK_URL = "https://acme.slack.com/archives/C024BE91L/p1732714320000200";

beforeEach(() => {
  db.delete(videoMemos).run();
  lookups.calls.length = 0;
});

describe("memos router", () => {
  it("adds a direct memo by default, now, with the looked-up title", async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await asAlice.memos.add({
      videoId: VIDEO,
      text: "  Watch at 3:10 ",
    });
    expect(res.created).toBe(true);
    expect(res.addedToPlaylist).toBe(false);
    expect(res.memo).toMatchObject({
      videoId: VIDEO,
      text: "Watch at 3:10",
      source: { kind: "direct", url: null },
    });
    expect(res.memo.occurredAt).toBeGreaterThanOrEqual(before);
    const row = db.select().from(videoMemos).get();
    expect(row).toMatchObject({
      videoTitle: `Title of ${VIDEO}`,
      channelName: "Looked-up channel",
      channelId: "UCfromlookup000000000000",
    });
  });

  it("skips the lookup when the client sends what it knows", async () => {
    await asAlice.memos.add({
      videoId: VIDEO,
      channelId: "UCclient0000000000000000",
      videoTitle: "Known title",
      channelName: "Known channel",
      text: "x",
    });
    expect(lookups.calls).toEqual([]);
    expect(db.select().from(videoMemos).get()?.videoTitle).toBe("Known title");
  });

  it("lists oldest first and only the caller's memos", async () => {
    await asAlice.memos.add({
      videoId: VIDEO,
      text: "second",
      occurredAt: 2000,
    });
    await asAlice.memos.add({
      videoId: VIDEO,
      text: "first",
      occurredAt: 1000,
    });
    await asAlice.memos.add({ videoId: OTHER_VIDEO, text: "elsewhere" });
    await asBob.memos.add({ videoId: VIDEO, text: "bob's" });
    expect(
      (await asAlice.memos.list({ videoId: VIDEO })).map((m) => m.text),
    ).toEqual(["first", "second"]);
    expect(
      (await asBob.memos.list({ videoId: VIDEO })).map((m) => m.text),
    ).toEqual(["bob's"]);
  });

  it("accepts a Slack ts, an ISO time and a Date for occurredAt", async () => {
    const a = await asAlice.memos.add({
      videoId: VIDEO,
      text: "ts",
      occurredAt: "1732714320.000200",
    });
    const b = await asAlice.memos.add({
      videoId: VIDEO,
      text: "iso",
      occurredAt: "2024-11-27T13:32:00Z",
    });
    const c = await asAlice.memos.add({
      videoId: VIDEO,
      text: "date",
      occurredAt: new Date("2024-11-27T13:32:00Z"),
    });
    expect(a.memo.occurredAt).toBe(1732714320);
    expect(b.memo.occurredAt).toBe(1732714320);
    expect(c.memo.occurredAt).toBe(1732714320);
  });

  it("stores a Slack message once, however often it is sent", async () => {
    const input = {
      videoId: VIDEO,
      text: "Love this one",
      occurredAt: 1732714320,
      source: {
        kind: "slack" as const,
        url: SLACK_URL,
        label: "#design",
        author: "Anna",
        workspace: "Acme",
      },
    };
    const first = await asAlice.memos.add(input);
    const retry = await asAlice.memos.add({ ...input, text: "changed text" });
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.memo).toEqual(first.memo);
    expect(first.memo.source).toEqual({
      kind: "slack",
      url: SLACK_URL,
      label: "#design",
      author: "Anna",
      workspace: "Acme",
    });
    expect(await asAlice.memos.list({ videoId: VIDEO })).toHaveLength(1);
    // Another account may store the same message for itself.
    expect((await asBob.memos.add(input)).created).toBe(true);
  });

  it("requires a URL for slack and link memos", async () => {
    await expect(
      asAlice.memos.add({
        videoId: VIDEO,
        text: "x",
        // @ts-expect-error url is required
        source: { kind: "slack", label: "#design" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asAlice.memos.add({
        videoId: VIDEO,
        text: "x",
        source: { kind: "link", url: "javascript:alert(1)" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects empty, too long and badly addressed memos", async () => {
    await expect(
      asAlice.memos.add({ videoId: VIDEO, text: "   " }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asAlice.memos.add({ videoId: VIDEO, text: "x".repeat(5001) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      asAlice.memos.add({ videoId: "not a video", text: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("edits direct memos and keeps source memos read-only", async () => {
    const direct = await asAlice.memos.add({ videoId: VIDEO, text: "draft" });
    const slack = await asAlice.memos.add({
      videoId: VIDEO,
      text: "quote",
      source: { kind: "slack", url: SLACK_URL },
    });
    const link = await asAlice.memos.add({
      videoId: VIDEO,
      text: "quote",
      source: { kind: "link", url: "https://example.com/post" },
    });
    const edited = await asAlice.memos.update({
      id: direct.memo.id,
      text: "final",
    });
    expect(edited.text).toBe("final");
    for (const m of [slack.memo, link.memo]) {
      await expect(
        asAlice.memos.update({ id: m.id, text: "rewritten" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(
      (await asAlice.memos.list({ videoId: VIDEO })).map((m) => m.text),
    ).toEqual(["final", "quote", "quote"]);
  });

  it("deletes any kind of memo", async () => {
    const slack = await asAlice.memos.add({
      videoId: VIDEO,
      text: "quote",
      source: { kind: "slack", url: SLACK_URL },
    });
    const removed = await asAlice.memos.remove({ id: slack.memo.id });
    expect(removed).toEqual(slack.memo);
    expect(await asAlice.memos.list({ videoId: VIDEO })).toEqual([]);
  });

  it("keeps other accounts' memos out of reach", async () => {
    const mine = await asAlice.memos.add({ videoId: VIDEO, text: "mine" });
    await expect(
      asBob.memos.update({ id: mine.memo.id, text: "hijack" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      asBob.memos.remove({ id: mine.memo.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await asBob.memos.counts({ videoIds: [VIDEO] })).toEqual([]);
    expect(
      (await asAlice.memos.list({ videoId: VIDEO })).map((m) => m.text),
    ).toEqual(["mine"]);
  });

  it("refuses signed-out callers", async () => {
    const anon = appRouter.createCaller({ db, userId: null });
    await expect(anon.memos.list({ videoId: VIDEO })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("counts memos per video with the latest text", async () => {
    await asAlice.memos.add({ videoId: VIDEO, text: "old", occurredAt: 1000 });
    await asAlice.memos.add({ videoId: VIDEO, text: "new", occurredAt: 3000 });
    await asAlice.memos.add({ videoId: VIDEO, text: "mid", occurredAt: 2000 });
    await asAlice.memos.add({ videoId: OTHER_VIDEO, text: "only" });
    const counts = await asAlice.memos.counts({
      videoIds: [VIDEO, OTHER_VIDEO, "noMemos0000"],
    });
    expect(
      [...counts].sort((a, b) => a.videoId.localeCompare(b.videoId)),
    ).toEqual(
      [
        { videoId: OTHER_VIDEO, count: 1, latestText: "only" },
        { videoId: VIDEO, count: 3, latestText: "new" },
      ].sort((a, b) => a.videoId.localeCompare(b.videoId)),
    );
    expect(await asAlice.memos.counts({ videoIds: [] })).toEqual([]);
  });

  describe("playlistId", () => {
    it("adds the video to the user's playlist, once", async () => {
      const { id } = await asAlice.playlists.create({ name: "From Slack" });
      const input = {
        videoId: VIDEO,
        text: "for the list",
        playlistId: id,
        source: { kind: "slack" as const, url: SLACK_URL },
      };
      const first = await asAlice.memos.add(input);
      const retry = await asAlice.memos.add(input);
      await asAlice.memos.add({ ...input, source: undefined, text: "again" });
      expect(first.addedToPlaylist).toBe(true);
      expect(retry.addedToPlaylist).toBe(true);
      const items = db.select().from(playlistItems).all();
      expect(items.map((i) => i.videoId)).toEqual([VIDEO]);
      expect(items[0]?.channelId).toBe("UCfromlookup000000000000");
    });

    it("refuses another account's playlist and stores nothing", async () => {
      const { id } = await asBob.playlists.create({ name: "Bob's" });
      await expect(
        asAlice.memos.add({ videoId: VIDEO, text: "x", playlistId: id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await asAlice.memos.list({ videoId: VIDEO })).toEqual([]);
      expect((await asBob.playlists.items({ playlistId: id })).items).toEqual(
        [],
      );
    });
  });
});

describe("the memos API token scope", () => {
  it("is listed with its label", () => {
    expect(API_TOKEN_SCOPE_KEYS).toContain("memos");
    expect(API_TOKEN_SCOPES.memos.label).toBe("Add memos");
    expect(API_TOKEN_SCOPES.memos.procedures).toEqual(["memos.add"]);
  });

  it("allows memos.add and nothing else", () => {
    expect(apiTokenAllows(["memos"], "memos.add")).toBe(true);
    for (const path of [
      "memos.list",
      "memos.counts",
      "memos.update",
      "memos.remove",
      "playlists.addItem",
      "playlists.list",
      "search.library",
      "history.upsertEvent",
      "apiTokens.create",
    ]) {
      expect(apiTokenAllows(["memos"], path)).toBe(false);
    }
    expect(apiTokenAllows(["playback"], "memos.add")).toBe(false);
  });

  it("is what protectedProcedure enforces for a token caller", async () => {
    const token = { id: 1, userId: alice.id, scopes: ["memos" as const] };
    const asToken = appRouter.createCaller({
      db,
      userId: alice.id,
      apiToken: token,
    });
    const { memo } = await asToken.memos.add({
      videoId: VIDEO,
      text: "via token",
      source: { kind: "slack", url: SLACK_URL, label: "#design" },
    });
    expect(memo.text).toBe("via token");
    await expect(asToken.memos.list({ videoId: VIDEO })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(asToken.memos.remove({ id: memo.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      asToken.playlists.addItem({ playlistId: 1, videoId: VIDEO }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
