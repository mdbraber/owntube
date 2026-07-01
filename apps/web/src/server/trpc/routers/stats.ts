import { and, eq, gte, sql } from "drizzle-orm";
import { interactions, watchHistory } from "@/server/db/schema";
import {
  getRecommendationInsights,
  type RecommendationInsights,
} from "@/server/recommendation/engine";
import { fetchChannelPage } from "@/server/services/proxy";
import {
  getUserProxyOverrides,
  getUserSettings,
  normalizeTrendingRegionStored,
} from "@/server/settings/profile";
import { protectedProcedure, router } from "@/server/trpc/init";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

const EMPTY_INSIGHTS: RecommendationInsights = {
  coldStart: true,
  poolSize: 0,
  sourceComposition: [],
  topTopics: [],
  topVideos: [],
};

export const statsRouter = router({
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const since90d = nowUnix() - 90 * 24 * 3600;

    const totalHistory = ctx.db
      .select({ c: sql<number>`count(*)` })
      .from(watchHistory)
      .where(
        and(eq(watchHistory.userId, ctx.userId), eq(watchHistory.isDeleted, 0)),
      )
      .all()[0]?.c;

    const totalWatchSeconds = ctx.db
      .select({
        s: sql<number>`coalesce(sum(${watchHistory.durationWatched}), 0)`,
      })
      .from(watchHistory)
      .where(
        and(eq(watchHistory.userId, ctx.userId), eq(watchHistory.isDeleted, 0)),
      )
      .all()[0]?.s;

    const last90dHistory = ctx.db
      .select({
        c: sql<number>`count(*)`,
      })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, ctx.userId),
          eq(watchHistory.isDeleted, 0),
          gte(watchHistory.startedAt, since90d),
        ),
      )
      .all()[0]?.c;

    const topChannelsRaw = ctx.db
      .select({
        channelId: watchHistory.channelId,
        watchCount: sql<number>`count(*)`,
        watchSeconds: sql<number>`coalesce(sum(${watchHistory.durationWatched}), 0)`,
      })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, ctx.userId),
          eq(watchHistory.isDeleted, 0),
          gte(watchHistory.startedAt, since90d),
        ),
      )
      .groupBy(watchHistory.channelId)
      .orderBy(sql`count(*) desc`)
      .limit(8)
      .all();
    const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
    const topChannels = await Promise.all(
      topChannelsRaw.map(async (row) => {
        try {
          const channel = await fetchChannelPage(
            ctx.db,
            { channelId: row.channelId },
            overrides,
          );
          return { ...row, channelName: channel.name ?? row.channelId };
        } catch {
          return { ...row, channelName: row.channelId };
        }
      }),
    );

    const interactionTotals = ctx.db
      .select({
        type: interactions.type,
        c: sql<number>`count(*)`,
      })
      .from(interactions)
      .where(eq(interactions.userId, ctx.userId))
      .groupBy(interactions.type)
      .all();

    const byType = new Map(interactionTotals.map((x) => [x.type, x.c]));

    return {
      totalHistory: totalHistory ?? 0,
      totalWatchSeconds: totalWatchSeconds ?? 0,
      historyLast90d: last90dHistory ?? 0,
      likes: byType.get("like") ?? 0,
      dislikes: byType.get("dislike") ?? 0,
      saved: byType.get("save") ?? 0,
      topChannels,
    };
  }),

  /** Transparency view of the recommender: configured keywords, learned topics, feed source mix. */
  algorithmInsights: protectedProcedure.query(async ({ ctx }) => {
    const settings = getUserSettings(ctx.db, ctx.userId);
    const region = normalizeTrendingRegionStored(settings.trendingRegion);
    const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
    let insights = EMPTY_INSIGHTS;
    try {
      insights = await getRecommendationInsights(ctx.db, ctx.userId, {
        region,
        overrides,
      });
    } catch {
      // Upstream may be momentarily unavailable; the page still renders keywords
      // and the static stats, just without the live pool-derived sections.
    }
    return {
      keywords: settings.tasteKeywords,
      ...insights,
    };
  }),
});
