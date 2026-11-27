import { describe, expect, it, vi } from "vitest";
import {
  playlistItems,
  playlists,
  users,
  videoMemos,
} from "@/server/db/schema";
import { memoPreamble, withMemoPreamble } from "@/server/memos/feed-memos";
import type { VideoMemo } from "@/server/memos/memos";
import { buildAllFeeds } from "@/server/remote/publish";
import { upsertUserSettings } from "@/server/settings/profile";
import { createTestDb } from "@/test/db";

// The episode's own description, as the video page gives it.
vi.mock("@/server/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/catalog")>()),
  fetchVideoDetail: async ({ videoId }: { videoId: string }) => ({
    videoId,
    title: `Title ${videoId}`,
    description: "The video's own description.",
    durationSeconds: 200,
  }),
}));

const slack: VideoMemo = {
  id: 1,
  videoId: "dQw4w9WgXcQ",
  channelId: null,
  text: "The bridge is the vibe.",
  occurredAt: Date.UTC(2026, 10, 27, 13, 32) / 1000,
  createdAt: 0,
  updatedAt: 0,
  source: {
    kind: "slack",
    url: "https://acme.slack.com/archives/C1/p1",
    label: "#design",
    author: "Anna",
    workspace: "Acme",
  },
};
const direct: VideoMemo = {
  ...slack,
  id: 2,
  text: "Use it as the cold open.",
  occurredAt: Date.UTC(2026, 10, 27, 14, 0) / 1000,
  source: {
    kind: "direct",
    url: null,
    label: null,
    author: null,
    workspace: null,
  },
};

describe("memo preamble", () => {
  it("lists source, time, text and link per memo", () => {
    expect(memoPreamble([slack, direct])).toBe(
      [
        "Memos",
        "",
        "Anna in #design · 2026-11-27 13:32 UTC",
        "The bridge is the vibe.",
        "https://acme.slack.com/archives/C1/p1",
        "",
        "You · 2026-11-27 14:00 UTC",
        "Use it as the cold open.",
      ].join("\n"),
    );
  });

  it("goes above the description, or stands alone", () => {
    expect(withMemoPreamble("Original.", [direct])).toBe(
      "Memos\n\nYou · 2026-11-27 14:00 UTC\nUse it as the cold open.\n\n———\n\nOriginal.",
    );
    expect(withMemoPreamble(undefined, [direct])).toMatch(/^Memos\n/);
    expect(withMemoPreamble("Original.", [])).toBe("Original.");
  });
});

describe("playlist feeds with memos", () => {
  it("start descriptions with memos only when the setting is on", async () => {
    const { db, sqlite } = createTestDb();
    const user = db
      .insert(users)
      .values({
        email: "f@example.com",
        passwordHash: "x",
        createdAt: 0,
        updatedAt: 0,
      })
      .returning()
      .get();
    const list = db
      .insert(playlists)
      .values({ userId: user.id, name: "Picks", createdAt: 0, updatedAt: 0 })
      .returning()
      .get();
    db.insert(playlistItems)
      .values([
        {
          playlistId: list.id,
          videoId: "dQw4w9WgXcQ",
          addedAt: 0,
          position: 0,
        },
        {
          playlistId: list.id,
          videoId: "9bZkp7q19f0",
          addedAt: 0,
          position: 1,
        },
      ])
      .run();
    db.insert(videoMemos)
      .values({
        userId: user.id,
        videoId: "dQw4w9WgXcQ",
        text: "The bridge is the vibe.",
        occurredAt: slack.occurredAt,
        createdAt: 0,
        updatedAt: 0,
        sourceKind: "slack",
        sourceUrl: "https://acme.slack.com/archives/C1/p1",
        sourceLabel: "#design",
        sourceAuthor: "Anna",
      })
      .run();

    const descriptions = async () => {
      const { feeds } = await buildAllFeeds(db, { appOrigin: "http://x" });
      const feed = feeds.find((f) => f.kind === "playlist");
      return feed?.items.map((i) => i.description);
    };

    expect(await descriptions()).toEqual([
      "The video's own description.",
      "The video's own description.",
    ]);

    upsertUserSettings(db, user.id, { includeMemosInFeeds: true });
    const [withMemo, without] = (await descriptions()) ?? [];
    expect(withMemo).toBe(
      "Memos\n\nAnna in #design · 2026-11-27 13:32 UTC\nThe bridge is the vibe.\nhttps://acme.slack.com/archives/C1/p1\n\n———\n\nThe video's own description.",
    );
    expect(without).toBe("The video's own description.");
    sqlite.close();
  });
});
