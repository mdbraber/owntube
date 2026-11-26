/**
 * One warm cycle, by hand (`pnpm warm:cache`); the web app runs it on a
 * schedule itself (see `src/server/warm-cache/job.ts`).
 */
import { getDb } from "../src/server/db/client";
import { runWarmCycle } from "../src/server/warm-cache/job";

runWarmCycle(getDb()).then(
  (ok) => {
    if (!ok) process.exitCode = 1;
  },
  (error: unknown) => {
    process.stderr.write(
      `warm-cache failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
