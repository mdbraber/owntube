import { describe, expect, it } from "vitest";
import { interactions, users, watchHistory } from "@/server/db/schema";
import {
  classifyWatchEngagement,
  collectUserSignals,
  dislikeCorpusVideoIds,
} from "@/server/recommendation/signals";
import { createTestDb } from "@/test/db";

function seedUser(db: ReturnType<typeof createTestDb>["db"]): number {
  const now = Math.floor(Date.now() / 1000);
  return db
    .insert(users)
    .values({
      email: "signals@example.com",
      passwordHash: "x",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id })
    .get().id;
}

describe("collectUserSignals — excludeShorts", () => {
  it("drops Shorts-feed channels from the long-form signal", () => {
    const { db } = createTestDb();
    const userId = seedUser(db);
    const now = Math.floor(Date.now() / 1000);

    // A real long-form watch and a glanced short from a junk channel.
    db.insert(watchHistory)
      .values([
        {
          userId,
          videoId: "longformVid1",
          channelId: "UC-real",
          startedAt: now - 100,
          isShort: 0,
          createdAt: now,
        },
        {
          userId,
          videoId: "shortVid1",
          channelId: "UC-junk-short",
          startedAt: now - 50,
          isShort: 1,
          createdAt: now,
        },
      ])
      .run();

    const longform = collectUserSignals(db, userId, { excludeShorts: true });
    expect(longform.channelWeights.has("UC-real")).toBe(true);
    expect(longform.channelWeights.has("UC-junk-short")).toBe(false);
    expect(longform.totalWatches).toBe(1);

    // Default (no exclusion) still sees both — the Shorts pool relies on this.
    const all = collectUserSignals(db, userId);
    expect(all.channelWeights.has("UC-junk-short")).toBe(true);
    expect(all.totalWatches).toBe(2);
  });
});

describe("classifyWatchEngagement", () => {
  it("classifies rows by dwell share with legacy rows always unknown", () => {
    const longForm = { isShort: 0 };
    const cases: Array<
      [Parameters<typeof classifyWatchEngagement>[0], string]
    > = [
      // Legacy / untrusted rows: no video length recorded.
      [
        {
          ...longForm,
          durationWatched: 600,
          completed: 1,
          videoDurationSeconds: 0,
        },
        "unknown",
      ],
      // No dwell recorded (pings may not have arrived).
      [
        {
          ...longForm,
          durationWatched: 0,
          completed: 0,
          videoDurationSeconds: 600,
        },
        "unknown",
      ],
      [
        {
          ...longForm,
          durationWatched: 550,
          completed: 1,
          videoDurationSeconds: 600,
        },
        "completed",
      ],
      // ≥70% watched without the completed flag.
      [
        {
          ...longForm,
          durationWatched: 430,
          completed: 0,
          videoDurationSeconds: 600,
        },
        "engaged",
      ],
      // Quick bounce: little absolute dwell and a small share.
      [
        {
          ...longForm,
          durationWatched: 10,
          completed: 0,
          videoDurationSeconds: 600,
        },
        "skip",
      ],
      // 44s of a 60s video is most of it — not a skip despite < 45s dwell.
      [
        {
          ...longForm,
          durationWatched: 44,
          completed: 0,
          videoDurationSeconds: 60,
        },
        "engaged",
      ],
      // 20 min into an hour-long video: legitimate mid-way exit, neutral.
      [
        {
          ...longForm,
          durationWatched: 1200,
          completed: 0,
          videoDurationSeconds: 3600,
        },
        "neutral",
      ],
      // Shorts: a 2s glance is a scroll-past.
      [
        {
          isShort: 1,
          durationWatched: 2,
          completed: 0,
          videoDurationSeconds: 30,
        },
        "skip",
      ],
      [
        {
          isShort: 1,
          durationWatched: 28,
          completed: 1,
          videoDurationSeconds: 30,
        },
        "completed",
      ],
      [
        {
          isShort: 1,
          durationWatched: 10,
          completed: 0,
          videoDurationSeconds: 30,
        },
        "neutral",
      ],
    ];
    for (const [row, expected] of cases) {
      expect(classifyWatchEngagement(row), JSON.stringify(row)).toBe(expected);
    }
  });
});

describe("collectUserSignals — engagement weighting", () => {
  it("weights completed watches above quick skips at equal age", () => {
    const { db } = createTestDb();
    const userId = seedUser(db);
    const now = Math.floor(Date.now() / 1000);

    db.insert(watchHistory)
      .values([
        {
          userId,
          videoId: "finishedVid1",
          channelId: "UC-loved",
          startedAt: now - 100,
          durationWatched: 580,
          completed: 1,
          videoDurationSeconds: 600,
          isShort: 0,
          createdAt: now,
        },
        {
          userId,
          videoId: "bouncedVid01",
          channelId: "UC-bounced",
          startedAt: now - 100,
          durationWatched: 10,
          completed: 0,
          videoDurationSeconds: 600,
          isShort: 0,
          createdAt: now,
        },
      ])
      .run();

    const signals = collectUserSignals(db, userId);
    const loved = signals.channelWeights.get("UC-loved") ?? 0;
    const bounced = signals.channelWeights.get("UC-bounced") ?? 0;
    expect(loved / bounced).toBeCloseTo(1.3 / 0.15, 5);
    expect(signals.quickSkipVideoIds.has("bouncedVid01")).toBe(true);
    expect(signals.quickSkipVideoIds.has("finishedVid1")).toBe(false);
  });

  it("keeps legacy rows (no recorded length) at exactly the old weight", () => {
    const { db } = createTestDb();
    const userId = seedUser(db);
    const now = Math.floor(Date.now() / 1000);
    const startedAt = now - 100;

    db.insert(watchHistory)
      .values({
        userId,
        videoId: "legacyVid001",
        channelId: "UC-legacy",
        startedAt,
        durationWatched: 600,
        completed: 1,
        videoDurationSeconds: 0,
        isShort: 0,
        createdAt: now,
      })
      .run();

    const signals = collectUserSignals(db, userId);
    const weight = signals.channelWeights.get("UC-legacy") ?? 0;
    const expected = Math.exp(
      -(Math.floor(Date.now() / 1000) - startedAt) / (6 * 24 * 3600),
    );
    expect(weight).toBeCloseTo(expected, 3);
    expect(signals.quickSkipVideoIds.size).toBe(0);
  });

  it("does not flag a skipped-then-liked video or a completed watch as quick-skip", () => {
    const { db } = createTestDb();
    const userId = seedUser(db);
    const now = Math.floor(Date.now() / 1000);

    db.insert(watchHistory)
      .values([
        // Bounce, then liked anyway.
        {
          userId,
          videoId: "likedAnyway1",
          channelId: "UC-a",
          startedAt: now - 200,
          durationWatched: 8,
          completed: 0,
          videoDurationSeconds: 600,
          isShort: 0,
          createdAt: now,
        },
        // A single row per video (see watch_history dedupe): the mount event and
        // the later completed watch collapse into one completed row.
        {
          userId,
          videoId: "twoRowsVid01",
          channelId: "UC-b",
          startedAt: now - 100,
          durationWatched: 590,
          completed: 1,
          videoDurationSeconds: 600,
          isShort: 0,
          createdAt: now,
        },
      ])
      .run();
    db.insert(interactions)
      .values({
        userId,
        videoId: "likedAnyway1",
        channelId: "UC-a",
        type: "like",
        createdAt: now,
      })
      .run();

    const signals = collectUserSignals(db, userId);
    expect(signals.quickSkipVideoIds.has("likedAnyway1")).toBe(false);
    expect(signals.quickSkipVideoIds.has("twoRowsVid01")).toBe(false);
  });
});

describe("dislikeCorpusVideoIds", () => {
  it("orders explicit dislikes first and dedupes skipped-and-disliked ids", () => {
    const ids = dislikeCorpusVideoIds({
      dislikedVideoIds: new Set(["dis1", "dis2"]),
      quickSkipVideoIds: new Set(["dis1", "skip1", "skip2"]),
    });
    expect(ids).toEqual(["dis1", "dis2", "skip1", "skip2"]);
  });
});
