import { describe, expect, it } from "vitest";
import {
  createFeedPublisher,
  DEFAULT_TIMING,
  type PublishState,
  publishReason,
} from "./publish-loop";

const T = DEFAULT_TIMING; // quiet 30, maxWait 120, interval 1800

describe("publishReason", () => {
  it("waits for writes to go quiet", () => {
    expect(
      publishReason({ dirtyAt: 1000, publishedAt: 990 }, 1010, T),
    ).toBeNull();
    expect(publishReason({ dirtyAt: 1000, publishedAt: 990 }, 1030, T)).toBe(
      "changed",
    );
  });

  it("waits for quiet when a fresh write follows a long idle, regardless of time since the last publish", () => {
    // 1700s since the last publish, but the write only landed 10s ago and the
    // loop only just noticed it (dirtySince = dirtyAt). Time since the last
    // publish must not trigger "changed" on its own — only time since the
    // loop first saw the change unpublished does.
    expect(
      publishReason({ dirtyAt: 1_700, publishedAt: 0 }, 1_710, T, 1_700),
    ).toBeNull();
  });

  it("publishes once maxWait has passed since the loop first saw the change", () => {
    expect(
      publishReason({ dirtyAt: 1119, publishedAt: 1000 }, 1120, T, 1000),
    ).toBe("changed");
  });

  it("republishes on the interval without changes", () => {
    expect(
      publishReason({ dirtyAt: 0, publishedAt: 1000 }, 2799, T),
    ).toBeNull();
    expect(publishReason({ dirtyAt: 0, publishedAt: 1000 }, 2800, T)).toBe(
      "interval",
    );
  });
});

function harness(initial: PublishState) {
  const state = { ...initial };
  let clock = 10_000;
  const calls = { publish: 0, replay: 0 };
  let failPublish = false;
  const publisher = createFeedPublisher({
    readState: () => ({ ...state }),
    markPublished: (at) => {
      state.publishedAt = at;
    },
    publish: async () => {
      calls.publish++;
      if (failPublish) throw new Error("feeds server unreachable");
      return { feedCount: 3, itemCount: 12 };
    },
    replay: async () => {
      calls.replay++;
    },
    now: () => clock,
    log: () => {},
  });
  return {
    state,
    calls,
    publisher,
    advance: (s: number) => {
      clock += s;
    },
    now: () => clock,
    setFail: (v: boolean) => {
      failPublish = v;
    },
  };
}

describe("createFeedPublisher", () => {
  it("publishes a quiet change once and stamps one second before the run began", async () => {
    const h = harness({ dirtyAt: 9_960, publishedAt: 9_000 });
    await h.publisher.tick();
    expect(h.calls.publish).toBe(1);
    expect(h.state.publishedAt).toBe(9_999);
    h.advance(10);
    await h.publisher.tick();
    expect(h.calls.publish).toBe(1);
  });

  it("republishes a write that landed in the same second the publish started", async () => {
    const h = harness({ dirtyAt: 9_960, publishedAt: 9_000 });
    await h.publisher.tick();
    h.state.dirtyAt = 10_000;
    h.advance(30);
    await h.publisher.tick();
    expect(h.calls.publish).toBe(2);
  });

  it("does not mark a failed publish and backs off for a minute", async () => {
    const h = harness({ dirtyAt: 9_960, publishedAt: 9_000 });
    h.setFail(true);
    await h.publisher.tick();
    expect(h.state.publishedAt).toBe(9_000);
    h.setFail(false);
    h.advance(50);
    await h.publisher.tick();
    expect(h.calls.publish).toBe(1);
    h.advance(10);
    await h.publisher.tick();
    expect(h.calls.publish).toBe(2);
    expect(h.state.publishedAt).toBe(10_059);
  });

  it("publishes once, 120s after bursty writes began, not on every quiet-less tick", async () => {
    const h = harness({ dirtyAt: 0, publishedAt: 9_000 });
    // A write lands every 10s (dirtyAt tracks "now"), so it's never quiet;
    // only maxWait, measured from the first tick that saw the change, can
    // trigger a publish.
    for (let i = 0; i < 12; i++) {
      h.state.dirtyAt = h.now();
      await h.publisher.tick();
      expect(h.calls.publish).toBe(0);
      h.advance(10);
    }
    h.state.dirtyAt = h.now();
    await h.publisher.tick();
    expect(h.calls.publish).toBe(1);
  });

  it("retries reading publish state after a failure, without publishing, and backs off for a minute", async () => {
    let readCalls = 0;
    const state = { dirtyAt: 9_960, publishedAt: 9_000 };
    let clock = 10_000;
    let publishCalls = 0;
    const publisher = createFeedPublisher({
      readState: () => {
        readCalls++;
        if (readCalls === 1) throw new Error("db locked");
        return { ...state };
      },
      markPublished: (at) => {
        state.publishedAt = at;
      },
      publish: async () => {
        publishCalls++;
        return { feedCount: 1, itemCount: 1 };
      },
      replay: async () => {},
      now: () => clock,
      log: () => {},
    });

    await publisher.tick();
    expect(publishCalls).toBe(0);

    clock += 50;
    await publisher.tick();
    expect(publishCalls).toBe(0);
    expect(readCalls).toBe(1); // still backed off, readState not retried yet

    clock += 10;
    await publisher.tick();
    expect(publishCalls).toBe(1);
    expect(readCalls).toBe(2);
  });

  it("replays history at start and then once per interval, however often it publishes", async () => {
    const h = harness({ dirtyAt: 0, publishedAt: 10_000 });
    await h.publisher.tick();
    expect(h.calls.replay).toBe(1);
    h.advance(1_799);
    await h.publisher.tick();
    expect(h.calls.replay).toBe(1);
    h.advance(1);
    await h.publisher.tick();
    expect(h.calls.replay).toBe(2);
  });

  it("skips a tick while the previous one is still running", async () => {
    const h = harness({ dirtyAt: 9_960, publishedAt: 9_000 });
    await Promise.all([h.publisher.tick(), h.publisher.tick()]);
    expect(h.calls.publish).toBe(1);
  });

  describe("syncUploads", () => {
    function syncHarness(initial: PublishState, timing = DEFAULT_TIMING) {
      const state = { ...initial };
      let clock = 10_000;
      const calls = { publish: 0, sync: 0, order: [] as string[] };
      let failPublish = false;
      let failSync = false;
      const logs: string[] = [];
      const publisher = createFeedPublisher({
        readState: () => {
          calls.order.push("read");
          return { ...state };
        },
        markPublished: (at) => {
          state.publishedAt = at;
        },
        publish: async () => {
          calls.publish++;
          if (failPublish) throw new Error("feeds server unreachable");
          return { feedCount: 1, itemCount: 1 };
        },
        replay: async () => {},
        syncUploads: async () => {
          calls.sync++;
          calls.order.push("sync");
          if (failSync) throw new Error("hub queue unreachable");
        },
        now: () => clock,
        log: (msg) => logs.push(msg),
        timing,
      });
      return {
        state,
        calls,
        logs,
        publisher,
        advance: (s: number) => {
          clock += s;
        },
        setFailPublish: (v: boolean) => {
          failPublish = v;
        },
        setFailSync: (v: boolean) => {
          failSync = v;
        },
      };
    }

    it("runs before the publish decision on the first tick, then once per 60s", async () => {
      const h = syncHarness({ dirtyAt: 0, publishedAt: 10_000 });
      await h.publisher.tick();
      expect(h.calls.sync).toBe(1);
      expect(h.calls.order.slice(0, 2)).toEqual(["sync", "read"]);
      for (let i = 0; i < 5; i++) {
        h.advance(10);
        await h.publisher.tick();
      }
      expect(h.calls.sync).toBe(1); // 50s in
      h.advance(10);
      await h.publisher.tick();
      expect(h.calls.sync).toBe(2); // 60s in
    });

    it("a failing sync is logged and does not stop the publish", async () => {
      const h = syncHarness({ dirtyAt: 9_960, publishedAt: 9_000 });
      h.setFailSync(true);
      await h.publisher.tick();
      expect(h.calls.sync).toBe(1);
      expect(h.calls.publish).toBe(1);
      expect(
        h.logs.some(
          (l) =>
            l.startsWith("feed publisher:") &&
            l.includes("hub queue unreachable"),
        ),
      ).toBe(true);
    });

    it("keeps running while publishing is backed off", async () => {
      const h = syncHarness(
        { dirtyAt: 9_960, publishedAt: 9_000 },
        { ...DEFAULT_TIMING, webSubSyncSec: 20 },
      );
      h.setFailPublish(true);
      await h.publisher.tick(); // publish fails → backed off for 60s
      expect(h.calls.sync).toBe(1);
      h.advance(20);
      await h.publisher.tick();
      h.advance(20);
      await h.publisher.tick();
      expect(h.calls.publish).toBe(1); // still backed off…
      expect(h.calls.sync).toBe(3); // …but uploads kept syncing
    });

    it("is optional", async () => {
      const h = harness({ dirtyAt: 9_960, publishedAt: 9_000 });
      await h.publisher.tick();
      expect(h.calls.publish).toBe(1);
    });
  });
});
