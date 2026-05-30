import { describe, expect, it } from "vitest";
import {
  CHANNEL_META_TTL_SEC,
  isFreshChannelMeta,
} from "@/server/channel-meta/store";

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
