import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions, users } from "@/server/db/schema";
import { createTestDb } from "@/test/db";
import {
  clearWebSubHealthMemo,
  isWebSubCovered,
  recordWebSubHealth,
  WEBSUB_HEALTH_MAX_AGE_SEC,
  webSubStateHealthy,
} from "./health";

const CHANNEL = "UCabcdefghijklmnopqrstuv";
const OTHER = "UCzyxwvutsrqponmlkjihgfe";

function seedSubscription() {
  const { db, sqlite } = createTestDb();
  const t = Math.floor(Date.now() / 1000);
  const user = db
    .insert(users)
    .values({ email: "a@b.c", passwordHash: "x", createdAt: t, updatedAt: t })
    .returning()
    .get();
  db.insert(subscriptions)
    .values({ userId: user.id, channelId: CHANNEL, subscribedAt: t })
    .run();
  return { db, sqlite };
}

describe("websub health", () => {
  beforeEach(() => clearWebSubHealthMemo());

  it("is healthy only after a recent sync with most subscriptions active", () => {
    const now = 1_000_000;
    const ok = { okAt: now - 60, wanted: 100, active: 95, failing: 2 };
    expect(webSubStateHealthy(ok, now)).toBe(true);
    expect(
      webSubStateHealthy(
        { ...ok, okAt: now - WEBSUB_HEALTH_MAX_AGE_SEC - 1 },
        now,
      ),
    ).toBe(false);
    expect(webSubStateHealthy({ ...ok, active: 80 }, now)).toBe(false);
    expect(webSubStateHealthy({ ...ok, failing: 20 }, now)).toBe(false);
    expect(webSubStateHealthy({ ...ok, wanted: 0, active: 0 }, now)).toBe(
      false,
    );
  });

  it("covers a subscribed channel while healthy, nothing before the first sync", () => {
    const { db, sqlite } = seedSubscription();
    expect(isWebSubCovered(db, CHANNEL)).toBe(false);

    recordWebSubHealth(db, { wanted: 1, active: 1, failing: 0 });
    expect(isWebSubCovered(db, CHANNEL)).toBe(true);
    expect(isWebSubCovered(db, OTHER)).toBe(false);

    // A sync that long ago no longer counts.
    const old = Math.floor(Date.now() / 1000) - WEBSUB_HEALTH_MAX_AGE_SEC - 5;
    recordWebSubHealth(db, { wanted: 1, active: 1, failing: 0 }, old);
    expect(isWebSubCovered(db, CHANNEL)).toBe(false);
    sqlite.close();
  });
});
