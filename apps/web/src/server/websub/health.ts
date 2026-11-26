import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";

/**
 * Whether WebSub push is working, shared between processes (the app runs the
 * sync; the cache warmer is another container) through `websub_state`.
 *
 * While it works, a subscribed channel's new uploads arrive by push within a
 * minute or two and refresh its RSS at once (`syncWebSub`), so polling that
 * RSS every 15 minutes only re-asks YouTube for what we already know. Readers
 * use `isWebSubCovered` to let such a channel's feeds stay fresh for hours;
 * when the sync stops succeeding, or too few subscriptions are active at the
 * hub, everything falls back to the short polling TTL within minutes.
 */

/** A successful sync at least this recent counts (it runs about once a minute). */
export const WEBSUB_HEALTH_MAX_AGE_SEC = 10 * 60;
/** Share of wanted subscriptions that must be active at the hub. */
const MIN_ACTIVE_SHARE = 0.9;
/** In-process memo, so a feed build reading 100 channels asks SQLite once. */
const MEMO_MS = 15_000;

export type WebSubStats = {
  wanted: number;
  active: number;
  failing: number;
};

let memo: {
  at: number;
  healthy: boolean;
  subscribed: Set<string>;
} | null = null;

/** Record a successful sync and the hub's subscription counts. */
export function recordWebSubHealth(
  db: AppDb,
  stats: WebSubStats,
  now = Math.floor(Date.now() / 1000),
): void {
  db.run(
    sql`UPDATE websub_state SET ok_at = ${now}, wanted = ${stats.wanted}, active = ${stats.active}, failing = ${stats.failing} WHERE id = 1`,
  );
  memo = null;
}

/** Pure health rule (exported for tests). */
export function webSubStateHealthy(
  state: { okAt: number; wanted: number; active: number; failing: number },
  now: number,
): boolean {
  if (now - state.okAt > WEBSUB_HEALTH_MAX_AGE_SEC) return false;
  if (state.wanted <= 0) return false;
  return (
    state.active >= state.wanted * MIN_ACTIVE_SHARE &&
    state.failing <= state.wanted * (1 - MIN_ACTIVE_SHARE)
  );
}

function load(db: AppDb, nowMs: number) {
  if (memo && nowMs - memo.at < MEMO_MS) return memo;
  const row = db.get<{
    ok_at: number;
    wanted: number;
    active: number;
    failing: number;
  }>(sql`SELECT ok_at, wanted, active, failing FROM websub_state WHERE id = 1`);
  const healthy = row
    ? webSubStateHealthy(
        {
          okAt: row.ok_at,
          wanted: row.wanted,
          active: row.active,
          failing: row.failing,
        },
        Math.floor(nowMs / 1000),
      )
    : false;
  const subscribed = new Set(
    db
      .all<{ channel_id: string }>(
        sql`SELECT DISTINCT channel_id FROM subscriptions`,
      )
      .map((r) => r.channel_id),
  );
  memo = { at: nowMs, healthy, subscribed };
  return memo;
}

/**
 * True when `channelId` is subscribed (so the feeds server has it at the hub)
 * and WebSub is currently healthy: its uploads arrive by push.
 */
export function isWebSubCovered(
  db: AppDb,
  channelId: string,
  nowMs = Date.now(),
): boolean {
  const state = load(db, nowMs);
  return state.healthy && state.subscribed.has(channelId);
}

/** Tests: forget the memo. */
export function clearWebSubHealthMemo(): void {
  memo = null;
}
