import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { replayRecentHistory } from "@/server/hooks/replay-history";
import { publishFeeds } from "@/server/remote/publish";

/**
 * Feed publisher, running inside the web app (it replaced the separate
 * feeds-pusher container). SQLite triggers stamp feed_publish_state.dirty_at
 * on every write to a table a feed is built from — including writes made by
 * other processes on the same database — so polling that one row is all the
 * change detection needed. The public feeds server works out which feeds
 * actually changed and announces those to the WebSub hub.
 *
 * It also runs the watch-history replay on the slow interval: re-firing the
 * last 48h through the hooks is what heals OwnTube → Pocket Casts after an
 * outage (pocket-sessions' own replay only covers the other direction).
 */

export type PublishState = { dirtyAt: number; publishedAt: number };

export type PublishTiming = {
  /** Publish once writes have been quiet this long… */
  quietSec: number;
  /** …or once this long has passed since the last publish, even mid-burst. */
  maxWaitSec: number;
  /** Republish at least this often (new uploads in channel feeds arrive
   * without a database write); also the history-replay cadence. */
  intervalSec: number;
};

export const DEFAULT_TIMING: PublishTiming = {
  quietSec: 30,
  maxWaitSec: 120,
  intervalSec: 1800,
};

const TICK_MS = 10_000;
const RETRY_AFTER_FAILURE_SEC = 60;

export function publishReason(
  state: PublishState,
  now: number,
  timing: PublishTiming,
): "changed" | "interval" | null {
  const sincePublish = now - state.publishedAt;
  if (
    state.dirtyAt > state.publishedAt &&
    (now - state.dirtyAt >= timing.quietSec ||
      sincePublish >= timing.maxWaitSec)
  ) {
    return "changed";
  }
  if (sincePublish >= timing.intervalSec) return "interval";
  return null;
}

export type FeedPublisherDeps = {
  readState: () => PublishState;
  markPublished: (at: number) => void;
  publish: () => Promise<{ feedCount: number; itemCount: number }>;
  replay: () => Promise<unknown>;
  now?: () => number;
  log?: (msg: string) => void;
  timing?: PublishTiming;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createFeedPublisher(deps: FeedPublisherDeps): {
  tick: () => Promise<void>;
} {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const timing = deps.timing ?? DEFAULT_TIMING;
  let running = false;
  let failedUntil = 0;
  let lastReplayAt = 0;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const startedAt = now();
      const reason =
        startedAt >= failedUntil
          ? publishReason(deps.readState(), startedAt, timing)
          : null;
      if (reason) {
        try {
          const { feedCount, itemCount } = await deps.publish();
          // One second back: a write landing in the same second this run
          // started stays newer than the stamp and triggers the next publish.
          // Publishing itself writes no table a feed trigger watches.
          deps.markPublished(startedAt - 1);
          log(
            `feed publisher: pushed ${feedCount} feed(s), ${itemCount} item(s) (${reason})`,
          );
        } catch (error) {
          failedUntil = startedAt + RETRY_AFTER_FAILURE_SEC;
          log(
            `feed publisher: publish failed, retrying in ${RETRY_AFTER_FAILURE_SEC}s: ${message(error)}`,
          );
        }
      }
      if (startedAt - lastReplayAt >= timing.intervalSec) {
        lastReplayAt = startedAt;
        try {
          await deps.replay();
        } catch (error) {
          log(`feed publisher: history replay failed: ${message(error)}`);
        }
      }
    } finally {
      running = false;
    }
  }

  return { tick };
}

let started = false;

/** Start publishing from this process. Only the prod container sets
 * OWNTUBE_PUBLISH_TARGET: dev shares its database, and two publishers would
 * race. */
export function startFeedPublisher(): boolean {
  const target = process.env.OWNTUBE_PUBLISH_TARGET?.trim() ?? "";
  const secret = process.env.OWNTUBE_PUBLISH_SECRET?.trim() ?? "";
  if (started || !target || !secret) return false;
  started = true;

  // Origin used to build enclosure/link URLs. Enclosures are further rewritten
  // to NEXT_PUBLIC_MEDIA_BASE_URL by toMediaOriginUrl, so this is mainly the app link.
  const appOrigin =
    process.env.OWNTUBE_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    "http://localhost:3000";
  const interval = Number.parseInt(
    process.env.OWNTUBE_PUBLISH_INTERVAL_SEC ?? "",
    10,
  );
  const timing: PublishTiming = {
    ...DEFAULT_TIMING,
    ...(interval > 0 ? { intervalSec: interval } : {}),
  };
  const log = (msg: string) => console.log(`[OwnTube] ${msg}`);
  const db = getDb();

  const publisher = createFeedPublisher({
    readState: () => {
      const row = db.get<
        { dirty_at: number; published_at: number } | undefined
      >(
        sql`SELECT dirty_at, published_at FROM feed_publish_state WHERE id = 1`,
      );
      return {
        dirtyAt: row?.dirty_at ?? 0,
        publishedAt: row?.published_at ?? 0,
      };
    },
    markPublished: (at) => {
      db.run(
        sql`UPDATE feed_publish_state SET published_at = ${at} WHERE id = 1`,
      );
    },
    publish: () => publishFeeds(db, { target, secret, appOrigin, onLog: log }),
    replay: () => replayRecentHistory(db, { onLog: log }),
    timing,
    log,
  });

  setInterval(() => void publisher.tick(), TICK_MS).unref();
  void publisher.tick();
  log(`feed publisher on → ${target} (interval ${timing.intervalSec}s)`);
  return true;
}
