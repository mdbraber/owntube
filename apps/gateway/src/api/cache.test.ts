import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TtlCache } from "./cache.ts";
import { sqliteCacheStore } from "./store.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gw-cache-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function counter(answer: () => unknown) {
  let calls = 0;
  return {
    load: async () => {
      calls++;
      return answer();
    },
    calls: () => calls,
  };
}

describe("TtlCache", () => {
  it("serves a fresh entry without asking again, and shares a miss", async () => {
    const cache = new TtlCache();
    const c = counter(() => "v");
    const [a, b] = await Promise.all([
      cache.get("k", 1000, 5000, c.load),
      cache.get("k", 1000, 5000, c.load),
    ]);
    expect([a, b, await cache.get("k", 1000, 5000, c.load)]).toEqual([
      "v",
      "v",
      "v",
    ]);
    expect(c.calls()).toBe(1);
  });

  it("stands in with a stale entry when the source fails, but not a too-old one", async () => {
    let clock = 0;
    const cache = new TtlCache({ now: () => clock });
    await cache.get("k", 1000, 5000, async () => "old");
    clock = 2000;
    expect(
      await cache.get("k", 1000, 5000, () =>
        Promise.reject(new Error("YouTube down")),
      ),
    ).toBe("old");
    clock = 6000;
    await expect(
      cache.get("k", 1000, 5000, () =>
        Promise.reject(new Error("YouTube down")),
      ),
    ).rejects.toThrow("YouTube down");
  });

  it("keeps answers on disk across instances", async () => {
    const file = path.join(dir, "metadata.sqlite");
    const first = sqliteCacheStore(file);
    await new TtlCache({ store: first }).get(
      "video:x",
      60_000,
      600_000,
      async () => ({ title: "t" }),
    );
    first.close();
    const second = sqliteCacheStore(file);
    const c = counter(() => ({ title: "fresh" }));
    expect(
      await new TtlCache({ store: second }).get(
        "video:x",
        60_000,
        600_000,
        c.load,
      ),
    ).toEqual({ title: "t" });
    expect(c.calls()).toBe(0);
    second.close();
  });
});

describe("sqliteCacheStore.prune", () => {
  it("drops expired entries, then the oldest beyond the cap", () => {
    const store = sqliteCacheStore(path.join(dir, "m.sqlite"));
    store.set("a", 1, 10, 100);
    store.set("b", 2, 20, 1_000);
    store.set("c", 3, 30, 1_000);
    store.set("d", 4, 40, 1_000);
    expect(store.prune(500, 2)).toBe(2);
    expect([store.get("a"), store.get("b")]).toEqual([undefined, undefined]);
    expect(store.get("c")?.value).toBe(3);
    store.close();
  });
});
