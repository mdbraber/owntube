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

  it("publishes mid-burst once maxWait has passed since the last publish", () => {
    expect(publishReason({ dirtyAt: 1119, publishedAt: 1000 }, 1120, T)).toBe(
      "changed",
    );
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
  const calls = { publish: 0, replay: 0, logs: [] as string[] };
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
    log: (m) => calls.logs.push(m),
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
});
