/**
 * The feeds pusher. Builds every user's feed snapshots (playlists, queue,
 * saved, subscription/tag/channel uploads) and POSTs them to the public feeds
 * server. Run one-shot via `pnpm push:feeds`; the deploy container loops it on
 * an interval (see docker-compose `owntube-feeds-pusher`).
 *
 * Each run first syncs WebSub with the same server (`syncWebSub`): hands it the
 * subscribed channels and applies the upload pushes it queued. That runs every
 * loop regardless of the publish skip below; a push that changed a channel
 * feed marks the library dirty, so the publish follows in the same run.
 *
 * It lives here as the pusher's entrypoint, but deliberately still imports the
 * web app's server modules: building a snapshot means reading the app's SQLite
 * database through its own schema and reusing its feed/RSS logic. Reimplementing
 * that here would be a second source of truth for what a feed contains.
 *
 * DB bootstrap mirrors `apps/web/scripts/warm-cache.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { runSqlMigrations } from "@/server/db/run-migrations";
import * as schema from "@/server/db/schema";
import { replayRecentHistory } from "@/server/hooks/replay-history";
import { publishFeeds } from "@/server/remote/publish";
import { syncWebSub } from "@/server/websub/sync";

const defaultPath = path.join(process.cwd(), "data", "owntube.db");
const dbPath = process.env.DATABASE_PATH ?? defaultPath;

const target = process.env.OWNTUBE_PUBLISH_TARGET?.trim() ?? "";
const secret = process.env.OWNTUBE_PUBLISH_SECRET?.trim() ?? "";
// Origin used to build enclosure/link URLs. Enclosures are further rewritten to
// NEXT_PUBLIC_MEDIA_BASE_URL by toMediaOriginUrl, so this is mainly the app link.
const appOrigin =
  process.env.OWNTUBE_APP_URL?.trim() ||
  process.env.APP_URL?.trim() ||
  process.env.AUTH_URL?.trim() ||
  "http://localhost:3000";

// The loop calls this often (see docker-compose \`owntube-feeds-pusher\`); a run
// only publishes when the library actually changed, or when the full interval
// has elapsed. SQLite triggers stamp feed_publish_state.dirty_at on every
// write to a table a feed is built from — including writes made by the
// playback bridge — so "changed" needs no cooperation from the app code.
const intervalSec = Number.parseInt(
  process.env.OWNTUBE_PUBLISH_INTERVAL_SEC ?? "1800",
  10,
);
// --force publishes regardless (manual runs, first deploy).
const force = process.argv.includes("--force");
const webSubEnabled = !["0", "false", "no", "off"].includes(
  (process.env.OWNTUBE_WEBSUB ?? "true").trim().toLowerCase(),
);

function logLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  if (!target || !secret) {
    process.stderr.write(
      "push-feeds: OWNTUBE_PUBLISH_TARGET and OWNTUBE_PUBLISH_SECRET are required\n",
    );
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  runSqlMigrations(
    sqlite,
    path.join(process.cwd(), "src/server/db/migrations"),
  );

  try {
    if (webSubEnabled) {
      try {
        const result = await syncWebSub(db, { target, secret, onLog: logLine });
        if (!result.enabled) {
          logLine(
            "websub: off on the feeds server (WEBSUB_CALLBACK_URL unset)",
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`websub sync failed: ${message}\n`);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const state = sqlite
      .prepare(
        "SELECT dirty_at, published_at FROM feed_publish_state WHERE id = 1",
      )
      .get() as { dirty_at: number; published_at: number } | undefined;
    const dirtyAt = state?.dirty_at ?? 0;
    const publishedAt = state?.published_at ?? 0;
    const changed = dirtyAt > publishedAt;
    const due = now - publishedAt >= intervalSec;
    if (!force && !changed && !due) {
      logLine(
        "push-feeds: nothing changed and interval not elapsed — skipping",
      );
      return;
    }
    // Stamp with the time the run STARTED: a change made while publishing
    // stays newer than published_at and triggers the next cycle.
    const startedAt = now;

    const { feedCount, itemCount } = await publishFeeds(db, {
      target,
      secret,
      appOrigin,
      onLog: logLine,
    });
    sqlite
      .prepare("UPDATE feed_publish_state SET published_at = ? WHERE id = 1")
      .run(startedAt);
    logLine(
      `publish-feeds: pushed ${feedCount} feed(s), ${itemCount} item(s) → ${target} (${changed ? "changed" : "interval"})`,
    );
    // Reconciliation sweep: re-fire recent watch state through the generic
    // hooks (OT_SOURCE=replay). Receivers dedupe — pocket-sessions' ahead-only
    // guard drops known state — so an outage heals within one push cycle and
    // steady state costs a handful of no-op hook runs. Kept on the SLOW
    // cadence: a change-triggered publish must not re-fire the sweep every
    // time someone edits a playlist.
    if (due || force) {
      await replayRecentHistory(db, { onLog: logLine });
    }
  } finally {
    sqlite.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`publish-feeds failed: ${message}\n`);
  process.exitCode = 1;
});
