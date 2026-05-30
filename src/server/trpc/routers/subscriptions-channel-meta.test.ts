import { describe, expect, it } from "vitest";

/** Mirrors subscriptions router TTL for channel_meta reuse. */
const CHANNEL_META_TTL_SEC = 7 * 24 * 60 * 60;

function isFreshChannelMeta(updatedAt: number, now: number): boolean {
  return now - updatedAt < CHANNEL_META_TTL_SEC;
}

describe("isFreshChannelMeta", () => {
  it("treats meta within TTL as fresh", () => {
    const now = 1_700_000_000;
    expect(isFreshChannelMeta(now - 60, now)).toBe(true);
    expect(isFreshChannelMeta(now - CHANNEL_META_TTL_SEC + 1, now)).toBe(true);
  });

  it("treats meta older than TTL as stale", () => {
    const now = 1_700_000_000;
    expect(isFreshChannelMeta(now - CHANNEL_META_TTL_SEC, now)).toBe(false);
    expect(isFreshChannelMeta(now - CHANNEL_META_TTL_SEC - 1, now)).toBe(false);
  });
});
