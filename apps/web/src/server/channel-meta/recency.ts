import { inArray } from "drizzle-orm";
import { nowUnix, setChannelLatestVideoAt } from "@/server/channel-meta/store";
import type { AppDb } from "@/server/db/client";
import { channelMeta } from "@/server/db/schema";
import {
  getChannelRssNewestPublishedAt,
  getLongFormWindows,
} from "@/server/rss/cache";

export type RefreshRecencyOptions = {
  /**
   * Skip channels whose recency was already computed within this window —
   * the cache warmer recomputes every cycle, so the interactive sidebar
   * mutation only fills gaps (new subscriptions, warmer downtime).
   */
  skipIfCheckedWithinSec?: number;
};

function channelsNeedingRecency(
  db: AppDb,
  channelIds: readonly string[],
  skipIfCheckedWithinSec: number,
): string[] {
  if (channelIds.length === 0) return [];
  const cutoff = nowUnix() - skipIfCheckedWithinSec;
  const rows = db
    .select({
      channelId: channelMeta.channelId,
      latestCheckedAt: channelMeta.latestCheckedAt,
    })
    .from(channelMeta)
    .where(inArray(channelMeta.channelId, [...channelIds]))
    .all();
  const checkedRecently = new Set(
    rows
      .filter((r) => (r.latestCheckedAt ?? 0) >= cutoff)
      .map((r) => r.channelId),
  );
  return channelIds.filter((c) => !checkedRecently.has(c));
}

function markChannelsRecencyChecked(
  db: AppDb,
  channelIds: readonly string[],
): void {
  if (channelIds.length === 0) return;
  try {
    db.update(channelMeta)
      .set({ latestCheckedAt: nowUnix() })
      .where(inArray(channelMeta.channelId, [...channelIds]))
      .run();
  } catch {
    /* older DB without the column mid-migration: recency itself still works */
  }
}

/**
 * Refresh each channel's `latest_video_at` used for subscription ordering.
 * Prefers the long-form uploads window (excludes Shorts/premieres); channels
 * with no long-form window fall back to their (Shorts-inclusive) channel RSS
 * so Shorts-only channels still sort by their newest upload. Authoritative
 * overwrite. Returns the number of channels whose recency was set.
 *
 * Both signals come from the SQLite RSS cache (`@/server/rss/cache`,
 * serve-stale-and-revalidate), so this is a local query whenever the cache
 * warmer — which force-refreshes those rows every cycle before calling this —
 * is doing its job. Shared by the subscriptions `refreshRecency` mutation
 * (which passes `skipIfCheckedWithinSec`) and the warmer (which doesn't).
 */
export async function refreshChannelsLatestVideoAt(
  db: AppDb,
  channelIds: readonly string[],
  options?: RefreshRecencyOptions,
): Promise<number> {
  const skipSec = options?.skipIfCheckedWithinSec ?? 0;
  const targets =
    skipSec > 0
      ? channelsNeedingRecency(db, channelIds, skipSec)
      : [...channelIds];
  if (targets.length === 0) return 0;
  let updated = 0;

  const windows = await getLongFormWindows(db, targets);
  const noLongForm: string[] = [];
  for (const channelId of targets) {
    const newest = windows.get(channelId)?.newestPublishedAt;
    if (typeof newest === "number" && newest > 0) {
      setChannelLatestVideoAt(db, channelId, newest);
      updated++;
    } else {
      noLongForm.push(channelId);
    }
  }

  if (noLongForm.length > 0) {
    const newestByChannel = await Promise.all(
      noLongForm.map((channelId) =>
        getChannelRssNewestPublishedAt(db, channelId),
      ),
    );
    for (let i = 0; i < noLongForm.length; i++) {
      const newest = newestByChannel[i] ?? 0;
      const channelId = noLongForm[i];
      if (newest > 0 && channelId) {
        setChannelLatestVideoAt(db, channelId, newest);
        updated++;
      }
    }
  }

  markChannelsRecencyChecked(db, targets);
  return updated;
}
