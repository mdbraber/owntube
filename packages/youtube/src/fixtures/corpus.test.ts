import { beforeAll, describe, expect, it } from "vitest";
import { Innertube, Log } from "youtubei.js";
import { CORPUS } from "./corpus.ts";
import { createReplayFetch } from "./replay-fetch.ts";
import { listFixtures, readFixture } from "./store.ts";

/**
 * Every recorded fixture replays offline: the corpus entry's calls, answered
 * only from the recording, resolve to what the recording resolved to. This is
 * what makes the corpus usable as test input for everything built on it.
 */
const recorded = await listFixtures();

beforeAll(() => Log.setLevel(Log.Level.NONE));

describe("fixture corpus", () => {
  it("has a recording for every entry that does not need a hand-picked id", () => {
    const automatic = CORPUS.filter((e) => !e.manualId).map((e) => e.id);
    expect(recorded).toEqual(expect.arrayContaining(automatic));
  });

  for (const id of recorded) {
    it(`${id} replays offline`, async () => {
      const fixture = await readFixture(id);
      const entry = CORPUS.find((e) => e.id === id);
      if (!entry) throw new Error(`fixture ${id} has no corpus entry`);
      const yt = await Innertube.create({
        fetch: createReplayFetch(fixture.exchanges),
        lang: "en",
        retrieve_player: false,
        enable_session_cache: false,
      });
      expect(await entry.run(yt, fixture.resolved.videoId)).toEqual(
        fixture.resolved,
      );
    });
  }
});
