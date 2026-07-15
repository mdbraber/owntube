import type { UnifiedVideo } from "@/server/services/proxy.types";

/**
 * Per-user cache for the home feed's trending tail (the regional-trending rows
 * that fill in after the personalized head). Lives in its own module so that
 * both the feed router (which fills it) and the recommendation engine's
 * `clearRecommendationCachesForUser` (which drops it when taste, blocks, or
 * subscriptions change) can reach it without an import cycle.
 */

export type TrendingTailCacheEntry = {
  expiresAt: number;
  pool: UnifiedVideo[];
};

export const trendingTailPoolCache = new Map<string, TrendingTailCacheEntry>();
export const trendingTailPoolInFlight = new Map<
  string,
  Promise<TrendingTailCacheEntry>
>();

/**
 * Drop a user's cached tail so the next feed load rebuilds it — e.g. right
 * after they block a channel, so the block lands immediately instead of after
 * the 90s TTL. Cache keys are `tail|<userId>|…` (see `trendingTailCacheKey`).
 * With no id (or an invalid one) the whole cache is cleared.
 */
export function clearTrendingTailCacheForUser(userId?: number): void {
  if (typeof userId !== "number" || !Number.isFinite(userId) || userId <= 0) {
    trendingTailPoolCache.clear();
    trendingTailPoolInFlight.clear();
    return;
  }
  const prefix = `tail|${userId}|`;
  for (const key of trendingTailPoolCache.keys()) {
    if (key.startsWith(prefix)) trendingTailPoolCache.delete(key);
  }
  for (const key of trendingTailPoolInFlight.keys()) {
    if (key.startsWith(prefix)) trendingTailPoolInFlight.delete(key);
  }
}
