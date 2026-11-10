import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  memoMergedPage,
  mergedPageKey,
  resetMergedPageMemo,
} from "@/server/subscriptions/merged-page-cache";

beforeEach(() => resetMergedPageMemo());

describe("merged page memo", () => {
  it("serves the same channel set and window from one build for a minute", async () => {
    const build = vi.fn(async () => ["v1"]);
    const key = mergedPageKey(["UC1", "UC2"], 0, 24);
    expect(await memoMergedPage(key, build, 0)).toEqual(["v1"]);
    expect(await memoMergedPage(key, build, 59_000)).toEqual(["v1"]);
    expect(build).toHaveBeenCalledTimes(1);
    await memoMergedPage(key, build, 61_000);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("shares one build between concurrent requests", async () => {
    let resolve!: (v: string[]) => void;
    const build = vi.fn(
      () =>
        new Promise<string[]>((r) => {
          resolve = r;
        }),
    );
    const key = mergedPageKey(["UC1"], 0, 24);
    const a = memoMergedPage(key, build, 0);
    const b = memoMergedPage(key, build, 1);
    resolve(["v1"]);
    expect(await a).toEqual(["v1"]);
    expect(await b).toEqual(["v1"]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("keys on the channel set and the page window", () => {
    const base = mergedPageKey(["UC1", "UC2"], 0, 24);
    expect(mergedPageKey(["UC1", "UC2"], 24, 24)).not.toBe(base);
    expect(mergedPageKey(["UC1"], 0, 24)).not.toBe(base);
    expect(mergedPageKey(["UC1", "UC2"], 0, 48)).not.toBe(base);
  });

  it("doesn't keep a failed build", async () => {
    const key = mergedPageKey(["UC1"], 0, 24);
    await expect(
      memoMergedPage(key, async () => Promise.reject(new Error("upstream")), 0),
    ).rejects.toThrow("upstream");
    const build = vi.fn(async () => ["v1"]);
    expect(await memoMergedPage(key, build, 1)).toEqual(["v1"]);
    expect(build).toHaveBeenCalledTimes(1);
  });
});
