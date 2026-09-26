import { and, inArray, lte, sql } from "drizzle-orm";
import { refreshChannelsLatestVideoAt } from "@/server/channel-meta/recency";
import type { AppDb } from "@/server/db/client";
import { subscriptions, websubPushed } from "@/server/db/schema";
import {
  refreshChannelRss,
  refreshLongFormWindow,
  WEBSUB_PUSH_HOLD_SEC,
} from "@/server/rss/cache";
import { nowUnix } from "@/server/services/proxy/cache";
import { warmVideo } from "@/server/warm-cache/warm-video";

/**
 * Home half of WebSub push. The public feeds server (`feeds/server`, the only
 * host the hub can reach) subscribes every channel we hand it at Google's hub
 * and queues the signed upload notifications; this drains that queue over one
 * outbound call — home stays unreachable. The in-app feed publisher
 * (`remote/publish-loop.ts`) calls this about once a minute.
 *
 * A push is recorded in `websub_pushed` and the channel's RSS + long-form
 * window are refreshed at once. youtube.com's RSS usually lags the push, so the
 * refresh overlays the pushed entry (`mergeWebSubPushes`) and channels with
 * pushes still missing from their feed are re-fetched every few minutes until
 * it catches up. New uploads are also warmed (detail, streams, comments) so
 * they open instantly. Periodic polling (the cache warmer) stays as the safety
 * net: the hub is known to drop notifications now and then.
 */

/** Pushes older than this are edits of old videos, not uploads: the channel is
 * re-fetched (titles) but nothing is overlaid. */
const NEW_UPLOAD_WINDOW_SEC = 7 * 86_400;
/** Re-fetch channels whose push isn't in their RSS yet, at most this often. */
const RECHECK_EVERY_SEC = 240;
const REFRESH_CONCURRENCY = 5;
/** Cap per run so a burst (a channel re-publishing its back catalogue) can't
 * stall the publisher; the rest get warmed by the cache warmer or on open. */
const MAX_WARM_PER_RUN = 12;
const WARM_CONCURRENCY = 3;
const MAX_ROUNDS = 10;

const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{22}$/;

export type WebSubEvent = {
  id: number;
  channelId: string;
  videoId: string;
  deleted: boolean;
  title?: string;
  author?: string;
  publishedAt?: number;
};

type SyncResponse = {
  events: WebSubEvent[];
  stats: {
    wanted: number;
    active: number;
    pending: number;
    failing: number;
    queued: number;
  };
};

export type SyncWebSubOptions = {
  /** Feeds server origin (same as the publish target). */
  target: string;
  /** Bearer secret (same as the publish secret). */
  secret: string;
  onLog?: (line: string) => void;
};

export type SyncWebSubResult =
  | { enabled: false }
  | {
      enabled: true;
      events: number;
      channels: number;
      rechecked: number;
      warmed: number;
      stats: SyncResponse["stats"];
    };

function subscribedChannelIds(db: AppDb): string[] {
  const rows = db
    .selectDistinct({ channelId: subscriptions.channelId })
    .from(subscriptions)
    .all();
  return rows.map((r) => r.channelId).filter((c) => CHANNEL_ID_RE.test(c));
}

/**
 * Record events in `websub_pushed`. Returns the channels to re-fetch and the
 * new uploads among the events (edits of old videos and deletions excluded).
 */
export function recordWebSubEvents(
  db: AppDb,
  events: WebSubEvent[],
  now = nowUnix(),
): { channels: Set<string>; uploads: Set<string> } {
  const channels = new Set<string>();
  const uploads = new Set<string>();
  for (const e of events) {
    channels.add(e.channelId);
    const isNewUpload =
      !e.deleted &&
      typeof e.publishedAt === "number" &&
      e.publishedAt >= now - NEW_UPLOAD_WINDOW_SEC;
    if (isNewUpload) uploads.add(e.videoId);
    if (!e.deleted && !isNewUpload) continue;
    db.insert(websubPushed)
      .values({
        videoId: e.videoId,
        channelId: e.channelId,
        deleted: e.deleted ? 1 : 0,
        title: e.title ?? null,
        channelName: e.author ?? null,
        publishedAt: e.publishedAt ?? null,
        receivedAt: now,
        checkedAt: now,
      })
      .onConflictDoUpdate({
        target: websubPushed.videoId,
        set: {
          deleted: e.deleted ? 1 : 0,
          title: sql`coalesce(excluded.title, ${websubPushed.title})`,
          checkedAt: now,
        },
      })
      .run();
  }
  return { channels, uploads };
}

/** Channels with an upload push their RSS still lacks, due a re-fetch. */
export function channelsDueRecheck(db: AppDb, now = nowUnix()): string[] {
  const rows = db
    .selectDistinct({ channelId: websubPushed.channelId })
    .from(websubPushed)
    .where(
      and(
        sql`${websubPushed.deleted} = 0`,
        lte(websubPushed.checkedAt, now - RECHECK_EVERY_SEC),
      ),
    )
    .all();
  return rows.map((r) => r.channelId);
}

async function refreshChannels(db: AppDb, channelIds: string[]): Promise<void> {
  for (let i = 0; i < channelIds.length; i += REFRESH_CONCURRENCY) {
    await Promise.all(
      channelIds.slice(i, i + REFRESH_CONCURRENCY).map(async (channelId) => {
        await refreshChannelRss(db, channelId);
        await refreshLongFormWindow(db, channelId);
      }),
    );
  }
  if (channelIds.length > 0) {
    await refreshChannelsLatestVideoAt(db, channelIds);
  }
}

/** Warm videos a few at a time; returns how many had a usable detail. */
async function warmUploads(db: AppDb, videoIds: string[]): Promise<number> {
  let ok = 0;
  for (let i = 0; i < videoIds.length; i += WARM_CONCURRENCY) {
    const results = await Promise.all(
      videoIds
        .slice(i, i + WARM_CONCURRENCY)
        .map((id) => warmVideo(db, id, { sponsorBlock: false })),
    );
    ok += results.filter(Boolean).length;
  }
  return ok;
}

async function postSync(
  options: SyncWebSubOptions,
  body: { channels: string[]; ack: number | null },
): Promise<SyncResponse | null> {
  const base = options.target.replace(/\/+$/, "");
  const res = await fetch(`${base}/websub/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.secret}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`feeds server ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as SyncResponse;
}

/**
 * One sync pass: send the subscribed channel set, apply queued events, ack
 * them, and re-fetch channels whose pushes haven't reached their RSS. Events
 * are acked only on the next call, after they were applied — at-least-once;
 * applying twice is harmless.
 */
export async function syncWebSub(
  db: AppDb,
  options: SyncWebSubOptions,
): Promise<SyncWebSubResult> {
  const channels = subscribedChannelIds(db);
  let ack: number | null = null;
  let events = 0;
  let stats: SyncResponse["stats"] | null = null;
  const refreshed = new Set<string>();
  const uploads = new Set<string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await postSync(options, { channels, ack });
    if (!res) return { enabled: false };
    stats = res.stats;
    if (res.events.length === 0) break;
    const recorded = recordWebSubEvents(db, res.events);
    await refreshChannels(
      db,
      [...recorded.channels].filter((c) => !refreshed.has(c)),
    );
    for (const c of recorded.channels) refreshed.add(c);
    for (const v of recorded.uploads) uploads.add(v);
    events += res.events.length;
    // Acked by the next call — which also fetches whatever is left.
    ack = Math.max(...res.events.map((e) => e.id));
  }

  const now = nowUnix();
  // Normally resolved by `mergeWebSubPushes`; this catches channels no longer
  // refreshed (unsubscribed since the push).
  db.delete(websubPushed)
    .where(lte(websubPushed.receivedAt, now - WEBSUB_PUSH_HOLD_SEC))
    .run();
  const recheck = channelsDueRecheck(db, now).filter((c) => !refreshed.has(c));
  if (recheck.length > 0) {
    db.update(websubPushed)
      .set({ checkedAt: now })
      .where(inArray(websubPushed.channelId, recheck))
      .run();
    await refreshChannels(db, recheck);
  }

  // After the RSS refresh: the uploads are already listed while this runs.
  const warmed = await warmUploads(db, [...uploads].slice(0, MAX_WARM_PER_RUN));

  if (events > 0 || recheck.length > 0) {
    options.onLog?.(
      `websub: ${events} event(s) on ${refreshed.size} channel(s), warmed ${warmed}/${uploads.size} upload(s), rechecked ${recheck.length}`,
    );
  }
  return {
    enabled: true,
    events,
    channels: refreshed.size,
    rechecked: recheck.length,
    warmed,
    stats: stats ?? {
      wanted: 0,
      active: 0,
      pending: 0,
      failing: 0,
      queued: 0,
    },
  };
}
