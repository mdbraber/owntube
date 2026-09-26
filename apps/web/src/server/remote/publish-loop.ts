import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { replayRecentHistory } from "@/server/hooks/replay-history";
import { publishFeeds } from "@/server/remote/publish";
import { syncWebSub } from "@/server/websub/sync";

/**
 * Feed publisher, running inside the web app. SQLite triggers stamp feed_publish_state.dirty_at
 * on every write to a table a feed is built from — including writes made by
 * other processes on the same database — so polling that one row is all the
 * change detection needed. The public feeds server works out which feeds
 * actually changed and announces those to the WebSub hub.
 *
 * It also runs the watch-history replay on the slow interval: re-firing the
 * last 48h through the hooks is what heals OwnTube → Pocket Casts after an
 * outage (pocket-sessions' own replay only covers the other direction).
 *
 * And it drains YouTube WebSub upload pushes from the feeds server
 * (`syncWebSub`) about once a minute, at the start of a tick. A push that
 * changes a channel feed writes the RSS cache, which stamps dirty_at, so the
 * publish follows through the normal quiet/maxWait rules.
 */

export type PublishState = { dirtyAt: number; publishedAt: number };

export type PublishTiming = {
  /** Publish once writes have been quiet this long… */
  quietSec: number;
  /** …or once this long has passed since the loop first saw the current
   * change go unpublished, even if writes keep landing (mid-burst). */
  maxWaitSec: number;
  /** Republish at least this often (new uploads in channel feeds arrive
   * without a database write); also the history-replay cadence. */
  intervalSec: number;
  /** Drain WebSub upload pushes (`syncUploads`) at most this often. */
  webSubSyncSec: number;
};

export const DEFAULT_TIMING: PublishTiming = {
  quietSec: 30,
  maxWaitSec: 120,
  intervalSec: 1800,
  webSubSyncSec: 60,
};

const TICK_MS = 10_000;
const RETRY_AFTER_FAILURE_SEC = 60;

export function publishReason(
  state: PublishState,
  now: number,
  timing: PublishTiming,
  /** When the loop first saw this change go unpublished — not when it
   * actually landed. Undefined means the loop hasn't seen it as dirty yet. */
  dirtySince?: number,
): "changed" | "interval" | null {
  const sincePublish = now - state.publishedAt;
  if (
    state.dirtyAt > state.publishedAt &&
    (now - state.dirtyAt >= timing.quietSec ||
      (dirtySince !== undefined && now - dirtySince >= timing.maxWaitSec))
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
  /** Pull queued upload pushes from the feeds server. Runs regardless of
   * publish state and back-off; failures are logged, never fatal. */
  syncUploads?: () => Promise<unknown>;
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
  let lastSyncAt: number | undefined;
  /** When this loop first saw the current change go unpublished; cleared
   * once a publish succeeds, so a new burst starts its own maxWait clock. */
  let dirtySince: number | undefined;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const startedAt = now();
      if (
        deps.syncUploads &&
        (lastSyncAt === undefined ||
          startedAt - lastSyncAt >= timing.webSubSyncSec)
      ) {
        lastSyncAt = startedAt;
        try {
          await deps.syncUploads();
        } catch (error) {
          log(`feed publisher: websub sync failed: ${message(error)}`);
        }
      }
      // Re-read the clock: a slow sync must not leave the publish decision
      // (and the published-at stamp) looking at a stale "now".
      const decidedAt = now();
      let reason: "changed" | "interval" | null = null;
      if (decidedAt >= failedUntil) {
        try {
          const state = deps.readState();
          if (state.dirtyAt > state.publishedAt && dirtySince === undefined) {
            dirtySince = decidedAt;
          }
          reason = publishReason(state, decidedAt, timing, dirtySince);
        } catch (error) {
          failedUntil = decidedAt + RETRY_AFTER_FAILURE_SEC;
          log(
            `feed publisher: reading publish state failed, retrying in ${RETRY_AFTER_FAILURE_SEC}s: ${message(error)}`,
          );
        }
      }
      if (reason) {
        try {
          const { feedCount, itemCount } = await deps.publish();
          // One second back: a write landing in the same second this publish
          // was decided stays newer than the stamp and triggers the next publish.
          // Publishing itself writes no table a feed trigger watches.
          deps.markPublished(decidedAt - 1);
          dirtySince = undefined;
          log(
            `feed publisher: pushed ${feedCount} feed(s), ${itemCount} item(s) (${reason})`,
          );
        } catch (error) {
          failedUntil = decidedAt + RETRY_AFTER_FAILURE_SEC;
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

/** Start publishing from this process. Only the prod container may set
 * OWNTUBE_PUBLISH_SECRET: dev shares its database, and two publishers would
 * race. OWNTUBE_PUBLISH_TARGET can be set wherever the settings UI needs it
 * (it also builds the copyable feed URLs there) — this loop only starts when
 * both TARGET and SECRET are present. */
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
  const webSubOn = !["0", "false", "no", "off"].includes(
    (process.env.OWNTUBE_WEBSUB ?? "true").trim().toLowerCase(),
  );
  // Log "off on the feeds server" once per state change, not every minute.
  let webSubReportedOff = false;

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
    syncUploads: webSubOn
      ? async () => {
          const result = await syncWebSub(db, { target, secret, onLog: log });
          if (!result.enabled) {
            if (!webSubReportedOff) {
              log(
                "websub: off on the feeds server (WEBSUB_CALLBACK_URL unset)",
              );
            }
            webSubReportedOff = true;
          } else {
            webSubReportedOff = false;
          }
        }
      : undefined,
    timing,
    log,
  });

  setInterval(() => void publisher.tick(), TICK_MS).unref();
  void publisher.tick();
  log(
    `feed publisher on → ${target} (interval ${timing.intervalSec}s, websub ${webSubOn ? "on" : "off"})`,
  );
  return true;
}
