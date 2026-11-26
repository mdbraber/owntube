import { beforeAll, describe, expect, it } from "vitest";
import { Log } from "youtubei.js";
import { createCorpusContext } from "./context.ts";
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
  it("has a recording for every entry", () => {
    expect(recorded).toEqual(CORPUS.map((e) => e.id).sort());
  });

  for (const id of recorded) {
    it(`${id} replays offline`, async () => {
      const fixture = await readFixture(id);
      const entry = CORPUS.find((e) => e.id === id);
      if (!entry) throw new Error(`fixture ${id} has no corpus entry`);
      const { ctx } = await createCorpusContext(
        createReplayFetch(fixture.exchanges),
        fixture.resolved.videoId,
      );
      expect(await entry.run(ctx)).toEqual(fixture.resolved);
    });
  }
});
