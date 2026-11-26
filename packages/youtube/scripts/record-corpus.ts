/**
 * Records the fixture corpus from YouTube into packages/youtube/fixtures/corpus.
 *
 *   pnpm --filter @owntube/youtube record:corpus            # every entry
 *   pnpm --filter @owntube/youtube record:corpus video-hdr  # only these
 *   CORPUS_ID_VIDEO_POST_LIVE_DVR=<id> pnpm … record:corpus video-post-live-dvr  # pick the subject
 *
 * Each file is scrubbed of our address and visitor data before it is written;
 * the write is refused if anything identifying survives.
 */
import { createRequire } from "node:module";
import { Log } from "youtubei.js";
import { createCorpusContext } from "../src/fixtures/context.ts";
import { CORPUS, manualIdEnvName } from "../src/fixtures/corpus.ts";
import { scrubExchanges } from "../src/fixtures/scrub.ts";
import { writeFixture } from "../src/fixtures/store.ts";

// youtubei.js prints whole parser classes on every "X changed!" warning.
Log.setLevel(Log.Level.ERROR);

const youtubeiVersion = (
  createRequire(import.meta.url)("youtubei.js/package.json") as {
    version: string;
  }
).version;
const wanted = new Set(process.argv.slice(2));
const entries = CORPUS.filter((e) => wanted.size === 0 || wanted.has(e.id));
let failed = 0;

for (const entry of entries) {
  try {
    let subjectId = process.env[manualIdEnvName(entry.id)] || undefined;
    if (!subjectId && entry.discover) {
      subjectId = await entry.discover(
        (await createCorpusContext(fetch, undefined)).ctx,
      );
    }
    const { ctx, exchanges: recorded } = await createCorpusContext(
      fetch,
      subjectId,
    );
    const resolved = await entry.run(ctx);
    const exchanges = scrubExchanges(recorded);
    const target = await writeFixture({
      id: entry.id,
      recordedAt: new Date().toISOString(),
      youtubeiVersion,
      resolved,
      exchanges,
    });
    process.stdout.write(
      `ok    ${entry.id}  ${exchanges.length} exchanges  ${JSON.stringify(resolved)}  → ${target}\n`,
    );
  } catch (error) {
    failed++;
    process.stdout.write(
      `FAIL  ${entry.id}  ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

process.exitCode = failed > 0 ? 1 : 0;
