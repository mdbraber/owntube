/**
 * Warms SQLite upstream cache: trending, shorts shelf, channel meta, channel pages.
 * Run from the cache-warmer Docker sidecar or manually via `pnpm warm:cache`.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { refreshChannelsLatestVideoAt } from "../src/server/channel-meta/recency";
import { refreshChannelMetaIfStale } from "../src/server/channel-meta/store";
import type { AppDb } from "../src/server/db/client";
import { runSqlMigrations } from "../src/server/db/run-migrations";
import * as schema from "../src/server/db/schema";
import { RateLimitExceededError } from "../src/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "../src/server/errors/upstream-unavailable";
import { pruneAssetCache } from "../src/server/assets/cache";
import { watchQueue } from "../src/server/db/schema";
import {
  getUserProxyOverrides,
  getUserSettings,
  normalizeTrendingRegionStored,
} from "../src/server/settings/profile";
import { materializeHomeFeed } from "../src/server/trpc/routers/feed";
import {
  fetchChannelPage,
  fetchShortsFeed,
  fetchTrendingVideos,
  fetchVideoComments,
  fetchVideoDetail,
} from "../src/server/services/proxy";
import {
  DEFAULT_SPONSORBLOCK_CATEGORIES,
  getSponsorBlockSegments,
} from "../src/server/sponsorblock/service";
import {
  getChannelRssEntries,
  refreshChannelRss,
  refreshLongFormWindow,
} from "../src/server/rss/cache";
import {
  collectWarmChannelIds,
  DEFAULT_WARM_HISTORY_CHANNELS,
  DEFAULT_WARM_SUBSCRIPTION_CHANNELS,
} from "../src/server/warm-cache/collect-channel-ids";

const WARM_BATCH = 5;
const WARM_BATCH_PAUSE_MS = 80;

const defaultPath = path.join(process.cwd(), "data", "owntube.db");
const dbPath = process.env.DATABASE_PATH ?? defaultPath;
const region = (process.env.OWNTUBE_WARM_REGION ?? "US").trim().toUpperCase();
const trendingLimit = Number.parseInt(
  process.env.OWNTUBE_WARM_LIMIT ?? "48",
  10,
);
const historyChannelLimit = Number.parseInt(
  process.env.OWNTUBE_WARM_HISTORY_CHANNELS ??
    String(DEFAULT_WARM_HISTORY_CHANNELS),
  10,
);
const subscriptionChannelLimit = Number.parseInt(
  process.env.OWNTUBE_WARM_SUBSCRIPTION_CHANNELS ??
    String(DEFAULT_WARM_SUBSCRIPTION_CHANNELS),
  10,
);

function envFlag(name: string, defaultValue = true): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return defaultValue;
}

const warmChannelsEnabled = envFlag("OWNTUBE_WARM_CHANNELS", true);
const warmChannelPagesEnabled = envFlag("OWNTUBE_WARM_CHANNEL_PAGES", true);
const warmShortsEnabled = envFlag("OWNTUBE_WARM_SHORTS", true);
const warmRecencyEnabled = envFlag("OWNTUBE_WARM_RECENCY", true);
const warmRssEnabled = envFlag("OWNTUBE_WARM_RSS", true);
const warmVideosEnabled = envFlag("OWNTUBE_WARM_VIDEOS", true);
const warmHomeEnabled = envFlag("OWNTUBE_WARM_HOME", true);
const warmVideoLimit = Number.parseInt(
  process.env.OWNTUBE_WARM_VIDEO_LIMIT ?? "16",
  10,
);
const assetCacheMaxMb = Number.parseInt(
  process.env.OWNTUBE_ASSET_CACHE_MAX_MB ?? "1024",
  10,
);

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function runInBatches<T>(
  label: string,
  items: string[],
  worker: (item: string) => Promise<T>,
): Promise<{ ok: number; skipped: number; failed: number }> {
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i += WARM_BATCH) {
    if (i > 0) await sleepMs(WARM_BATCH_PAUSE_MS);
    const chunk = items.slice(i, i + WARM_BATCH);
    const settled = await Promise.allSettled(chunk.map((item) => worker(item)));
    for (const result of settled) {
      if (result.status === "rejected") {
        failed += 1;
        continue;
      }
      const value = result.value as { skipped?: boolean };
      if (value?.skipped) skipped += 1;
      else ok += 1;
    }
  }

  logLine(
    `warm-cache: ${label} — ok=${ok} skipped=${skipped} failed=${failed} total=${items.length}`,
  );
  return { ok, skipped, failed };
}

/**
 * Materialize each user's personalized home feed so the front page can be
 * SSR-prefetched cache-only and paints instantly. Runs after channel/RSS/video
 * warming so the reco engine reads warm candidate caches.
 */
async function warmHomeFeeds(db: AppDb): Promise<boolean> {
  const userRows = db.select({ id: schema.users.id }).from(schema.users).all();
  if (userRows.length === 0) return true;
  const stats = await runInBatches(
    "home feeds",
    userRows.map((u) => String(u.id)),
    async (idStr) => {
      const userId = Number.parseInt(idStr, 10);
      const settings = getUserSettings(db, userId);
      const userRegion = normalizeTrendingRegionStored(
        settings.trendingRegion ?? region,
      );
      await materializeHomeFeed(db, userId, {
        pageSize: 24,
        region: userRegion,
        overrides: getUserProxyOverrides(db, userId),
      });
    },
  );
  return stats.failed === 0;
}

async function warmTrending(db: AppDb): Promise<boolean> {
  const safeLimit =
    Number.isFinite(trendingLimit) && trendingLimit > 0
      ? Math.min(trendingLimit, 200)
      : 48;
  try {
    const result = await fetchTrendingVideos(db, {
      region,
      limit: safeLimit,
    });
    logLine(
      `warm-cache: trending — ${result.videos.length} videos (${result.sourceUsed}, region=${region})`,
    );
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`warm-cache: trending failed — ${message}`);
    return false;
  }
}

async function warmShortsShelf(db: AppDb): Promise<boolean> {
  try {
    const result = await fetchShortsFeed(
      db,
      { region, limit: 14, purpose: "shelf" },
      undefined,
    );
    logLine(
      `warm-cache: shorts shelf — ${result.videos.length} videos (${result.sourceUsed}, region=${region})`,
    );
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`warm-cache: shorts shelf failed — ${message}`);
    return false;
  }
}

async function warmChannelMeta(
  db: AppDb,
  channelIds: string[],
): Promise<boolean> {
  const stats = await runInBatches(
    "channel meta",
    channelIds,
    async (channelId) => {
      const meta = await refreshChannelMetaIfStale(db, channelId);
      return { skipped: !meta.refreshed };
    },
  );
  return stats.failed === 0;
}

/**
 * Force-refresh each channel's uploads RSS + long-form window rows. These are
 * what the merged subscriptions feed, Shorts classification, and recency read
 * (serve-stale-and-revalidate) — refreshing them here every cycle keeps the
 * interactive path SQLite-only.
 */
async function warmRssFeeds(db: AppDb, channelIds: string[]): Promise<boolean> {
  const stats = await runInBatches("rss feeds", channelIds, async (channelId) => {
    await refreshChannelRss(db, channelId);
    await refreshLongFormWindow(db, channelId);
    return {};
  });
  return stats.failed === 0;
}

async function warmChannelRecency(
  db: AppDb,
  channelIds: string[],
): Promise<boolean> {
  try {
    const updated = await refreshChannelsLatestVideoAt(db, channelIds);
    logLine(
      `warm-cache: channel recency — updated=${updated} total=${channelIds.length}`,
    );
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`warm-cache: channel recency failed — ${message}`);
    return false;
  }
}

async function warmChannelPages(
  db: AppDb,
  channelIds: string[],
): Promise<boolean> {
  const stats = await runInBatches(
    "channel pages",
    channelIds,
    async (channelId) => {
      try {
        const page = await fetchChannelPage(db, { channelId });
        return { skipped: page.videos.length === 0 };
      } catch (error) {
        if (
          error instanceof UpstreamUnavailableError ||
          error instanceof RateLimitExceededError
        ) {
          return { skipped: true };
        }
        throw error;
      }
    },
  );
  return stats.failed === 0;
}

/**
 * The videos a user is most likely to open next: the newest uploads across
 * their subscriptions (top of the merged home feed, from the just-warmed RSS
 * cache) plus everything queued.
 */
async function collectWarmVideoIds(
  db: AppDb,
  channelIds: string[],
  limit: number,
): Promise<string[]> {
  const perChannel = await Promise.all(
    channelIds.map((c) => getChannelRssEntries(db, c)),
  );
  const newestFirst = perChannel
    .flat()
    .filter((e) => typeof e.publishedAt === "number")
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  const ids = new Set<string>();
  for (const e of newestFirst) {
    if (ids.size >= limit) break;
    ids.add(e.videoId);
  }
  const queued = db
    .select({ videoId: watchQueue.videoId })
    .from(watchQueue)
    .limit(24)
    .all();
  for (const q of queued) ids.add(q.videoId);
  return [...ids];
}

/**
 * Pre-fetch what the watch page needs for likely-next videos: stream detail
 * (cached until its signed URLs near expiry), the first comments page, and
 * SponsorBlock segments — so clicking a video from the home feed is served
 * entirely from SQLite.
 */
async function warmVideoDetails(db: AppDb, videoIds: string[]): Promise<boolean> {
  const stats = await runInBatches("video details", videoIds, async (videoId) => {
    let ok = false;
    try {
      await fetchVideoDetail(db, { videoId });
      ok = true;
    } catch {
      /* age-restricted/unavailable: skip */
    }
    await fetchVideoComments(db, { videoId, sortBy: "top" }).catch(() => {});
    await getSponsorBlockSegments(db, {
      videoId,
      categories: [...DEFAULT_SPONSORBLOCK_CATEGORIES],
    }).catch(() => {});
    return { skipped: !ok };
  });
  return stats.failed === 0;
}

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  const migrationsFolder = path.join(process.cwd(), "src/server/db/migrations");
  runSqlMigrations(sqlite, migrationsFolder);

  let hadFailure = false;

  try {
    if (!(await warmTrending(db))) hadFailure = true;

    if (warmShortsEnabled && !(await warmShortsShelf(db))) hadFailure = true;

    const safeHistoryLimit =
      Number.isFinite(historyChannelLimit) && historyChannelLimit > 0
        ? Math.min(historyChannelLimit, 128)
        : DEFAULT_WARM_HISTORY_CHANNELS;
    const safeSubscriptionLimit =
      Number.isFinite(subscriptionChannelLimit) && subscriptionChannelLimit > 0
        ? Math.min(subscriptionChannelLimit, 256)
        : DEFAULT_WARM_SUBSCRIPTION_CHANNELS;
    const channelIds = collectWarmChannelIds(db, {
      subscriptionLimit: safeSubscriptionLimit,
      historyLimit: safeHistoryLimit,
    });

    if (channelIds.length === 0) {
      logLine("warm-cache: no subscription or history channels to warm");
    } else {
      logLine(`warm-cache: warming ${channelIds.length} channel(s)`);
      if (warmChannelsEnabled && !(await warmChannelMeta(db, channelIds))) {
        hadFailure = true;
      }
      // RSS before recency: recency reads the rows this step just refreshed.
      if (warmRssEnabled && !(await warmRssFeeds(db, channelIds))) {
        hadFailure = true;
      }
      if (warmRecencyEnabled && !(await warmChannelRecency(db, channelIds))) {
        hadFailure = true;
      }
      if (
        warmChannelPagesEnabled &&
        !(await warmChannelPages(db, channelIds))
      ) {
        hadFailure = true;
      }
      if (warmVideosEnabled) {
        const safeVideoLimit =
          Number.isFinite(warmVideoLimit) && warmVideoLimit > 0
            ? Math.min(warmVideoLimit, 64)
            : 16;
        const videoIds = await collectWarmVideoIds(
          db,
          channelIds,
          safeVideoLimit,
        );
        if (!(await warmVideoDetails(db, videoIds))) hadFailure = true;
      }

      const safeAssetMax =
        Number.isFinite(assetCacheMaxMb) && assetCacheMaxMb > 0
          ? assetCacheMaxMb
          : 1024;
      const pruned = await pruneAssetCache(safeAssetMax * 1024 * 1024);
      logLine(
        `warm-cache: asset cache — ${Math.round(pruned.totalBytes / 1024 / 1024)}MB, pruned=${pruned.removed}`,
      );
    }

    // After candidate caches are warm, materialize each user's home feed.
    if (warmHomeEnabled && !(await warmHomeFeeds(db))) hadFailure = true;
  } finally {
    sqlite.close();
  }

  if (hadFailure) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(`warm-cache failed: ${message}`);
  process.exitCode = 1;
});
