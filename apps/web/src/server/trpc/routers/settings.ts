import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defaultPlaybackQualitySchema } from "@/lib/default-playback-quality";
import { sponsorBlockCategorySchema } from "@/lib/sponsorblock";
import {
  interactions,
  publishedFeeds,
  subscriptions,
  userProfile,
  videoCache,
  watchHistory,
} from "@/server/db/schema";
import { clearRecommendationCachesForUser } from "@/server/recommendation/engine";
import { regenerateRssPass, secretFeedBase } from "@/server/remote/rss-pass";
import {
  appSettingsSchema,
  getUserSettings,
  upsertUserSettings,
} from "@/server/settings/profile";
import { protectedProcedure, router } from "@/server/trpc/init";

/**
 * A settings field without its `.default()`. Zod 4 fills defaults in even
 * under `.optional()`, so a patch built from the defaulted schema would reset
 * every field the caller left out.
 */
function withoutDefault<T extends z.ZodType>(
  schema: T,
): T extends z.ZodDefault<infer Inner> ? Inner : T {
  return (
    schema instanceof z.ZodDefault ? schema.unwrap() : schema
  ) as T extends z.ZodDefault<infer Inner> ? Inner : T;
}

const settingsPatchSchema = z.object({
  theme: withoutDefault(appSettingsSchema.shape.theme).optional(),
  visualTheme: withoutDefault(appSettingsSchema.shape.visualTheme).optional(),
  trendingRegion: z.string().length(2).optional(),
  hideShortsInSubscriptions: z.boolean().optional(),
  excludeSubscribedFromRecommendations: z.boolean().optional(),
  personalizedFeedOnly: z.boolean().optional(),
  defaultCinemaMode: z.boolean().optional(),
  includeMemosInFeeds: z.boolean().optional(),
  enableMiniPlayer: z.boolean().optional(),
  autoplayOnWatch: z.boolean().optional(),
  autoplayNext: z.boolean().optional(),
  shortsPreloadNext: z.boolean().optional(),
  defaultPlaybackQuality: defaultPlaybackQualitySchema.optional(),
  fullscreenAutoBestQuality: z.boolean().optional(),
  captionLanguage: withoutDefault(
    appSettingsSchema.shape.captionLanguage,
  ).optional(),
  sponsorBlockEnabled: z.boolean().optional(),
  sponsorBlockAutoSkip: z.boolean().optional(),
  sponsorBlockCategories: z.array(sponsorBlockCategorySchema).optional(),
  enableSwipeGestures: withoutDefault(
    appSettingsSchema.shape.enableSwipeGestures,
  ).optional(),
  swipeGestures: withoutDefault(
    appSettingsSchema.shape.swipeGestures,
  ).optional(),
  quickActions: withoutDefault(appSettingsSchema.shape.quickActions).optional(),
  homeBlocks: withoutDefault(appSettingsSchema.shape.homeBlocks).optional(),
  favoriteTag: z.string().min(1).max(40).optional(),
  bottomNav: withoutDefault(appSettingsSchema.shape.bottomNav).optional(),
  sidebarNav: withoutDefault(appSettingsSchema.shape.sidebarNav).optional(),
  sectionPrefs: withoutDefault(appSettingsSchema.shape.sectionPrefs).optional(),
});

const exportPayloadSchema = z.object({
  version: z.literal(1),
  exportedAt: z.number().int(),
  settings: appSettingsSchema,
  watchHistory: z.array(
    z.object({
      videoId: z.string(),
      channelId: z.string(),
      startedAt: z.number().int(),
      durationWatched: z.number().int(),
      completed: z.number().int(),
      isDeleted: z.number().int(),
      createdAt: z.number().int(),
      /** Optional so pre-denormalization exports keep importing. */
      videoTitle: z.string().nullish(),
      channelName: z.string().nullish(),
    }),
  ),
  interactions: z.array(
    z.object({
      videoId: z.string(),
      channelId: z.string().nullable(),
      type: z.string(),
      createdAt: z.number().int(),
    }),
  ),
  subscriptions: z.array(
    z.object({
      channelId: z.string(),
      subscribedAt: z.number().int(),
    }),
  ),
});

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export const settingsRouter = router({
  get: protectedProcedure.query(({ ctx }) => {
    return getUserSettings(ctx.db, ctx.userId);
  }),

  update: protectedProcedure
    .input(settingsPatchSchema)
    .mutation(({ ctx, input }) =>
      upsertUserSettings(ctx.db, ctx.userId, input),
    ),

  /** The account's secret feed addresses. */
  rssFeeds: protectedProcedure.query(({ ctx }) => {
    const base = secretFeedBase(ctx.db, ctx.userId);
    return {
      feedsUrl: base ? `${base}/` : null,
      queueUrls: base
        ? {
            audio: `${base}/queue/queue.audio.xml`,
            video: `${base}/queue/queue.video.xml`,
          }
        : null,
    };
  }),

  /** Rotates the password the secret feed addresses are derived from, so
   * every existing address (and any podcast subscription using it) breaks;
   * the feeds server picks up the new one at the next publish cycle. */
  regenerateRssPass: protectedProcedure.mutation(({ ctx }) => {
    regenerateRssPass(ctx.db, ctx.userId);
  }),

  /**
   * The secret address for one feed, resolved through the slugs the
   * publisher recorded on its last run. `url` is null when no feeds server
   * is configured or the feed hasn't been published yet (empty, or created
   * since the last publish cycle).
   */
  rssFeedUrl: protectedProcedure
    .input(
      z.object({
        kind: z.enum([
          "playlist",
          "queue",
          "saved",
          "subscriptions",
          "tag",
          "channel",
        ]),
        refId: z.string().min(1),
      }),
    )
    .query(({ ctx, input }) => {
      const none = (reason: "no-feeds-server" | "not-published") => ({
        audioUrl: null,
        videoUrl: null,
        reason,
      });
      const base = secretFeedBase(ctx.db, ctx.userId);
      if (!base) return none("no-feeds-server");
      const row = ctx.db
        .select({ slug: publishedFeeds.slug })
        .from(publishedFeeds)
        .where(
          and(
            eq(publishedFeeds.userId, ctx.userId),
            eq(publishedFeeds.kind, input.kind),
            eq(publishedFeeds.refId, input.refId),
          ),
        )
        .get();
      if (!row) return none("not-published");
      const feed = `${base}/${encodeURIComponent(input.kind)}/${encodeURIComponent(row.slug)}`;
      return {
        audioUrl: `${feed}.audio.xml`,
        videoUrl: `${feed}.video.xml`,
        reason: null,
      };
    }),

  clearCaches: protectedProcedure.mutation(({ ctx }) => {
    // The web app's own caches (RSS, SponsorBlock, home feed); YouTube's
    // catalogue is cached by the gateway.
    const cleared = ctx.db.delete(videoCache).run();
    clearRecommendationCachesForUser(ctx.userId);
    return { ok: true, clearedRows: Number(cleared.changes ?? 0) };
  }),

  exportData: protectedProcedure.query(({ ctx }) => {
    const settings = getUserSettings(ctx.db, ctx.userId);
    const historyRows = ctx.db
      .select({
        videoId: watchHistory.videoId,
        channelId: watchHistory.channelId,
        startedAt: watchHistory.startedAt,
        durationWatched: watchHistory.durationWatched,
        completed: watchHistory.completed,
        isDeleted: watchHistory.isDeleted,
        createdAt: watchHistory.createdAt,
        videoTitle: watchHistory.videoTitle,
        channelName: watchHistory.channelName,
      })
      .from(watchHistory)
      .where(eq(watchHistory.userId, ctx.userId))
      .all();

    const interactionRows = ctx.db
      .select({
        videoId: interactions.videoId,
        channelId: interactions.channelId,
        type: interactions.type,
        createdAt: interactions.createdAt,
      })
      .from(interactions)
      .where(eq(interactions.userId, ctx.userId))
      .all();

    const subscriptionRows = ctx.db
      .select({
        channelId: subscriptions.channelId,
        subscribedAt: subscriptions.subscribedAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, ctx.userId))
      .all();

    return exportPayloadSchema.parse({
      version: 1,
      exportedAt: nowUnix(),
      settings,
      watchHistory: historyRows,
      interactions: interactionRows,
      subscriptions: subscriptionRows,
    });
  }),

  importData: protectedProcedure
    .input(
      z.object({
        replaceExisting: z.boolean().default(true),
        payloadJson: z.string().min(2),
      }),
    )
    .mutation(({ ctx, input }) => {
      const parsed = exportPayloadSchema.parse(JSON.parse(input.payloadJson));
      const userId = ctx.userId;
      const ts = nowUnix();

      ctx.db.transaction((tx) => {
        if (input.replaceExisting) {
          tx.delete(watchHistory).where(eq(watchHistory.userId, userId)).run();
          tx.delete(interactions).where(eq(interactions.userId, userId)).run();
          tx.delete(subscriptions)
            .where(eq(subscriptions.userId, userId))
            .run();
        }

        tx.insert(userProfile)
          .values({
            userId,
            profileJson: JSON.stringify(parsed.settings),
            updatedAt: ts,
          })
          .onConflictDoUpdate({
            target: userProfile.userId,
            set: {
              profileJson: JSON.stringify(parsed.settings),
              updatedAt: ts,
            },
          })
          .run();

        for (const item of parsed.watchHistory) {
          tx.insert(watchHistory)
            .values({
              userId,
              videoId: item.videoId,
              channelId: item.channelId,
              startedAt: item.startedAt,
              durationWatched: item.durationWatched,
              completed: item.completed,
              isDeleted: item.isDeleted,
              createdAt: item.createdAt,
              videoTitle: item.videoTitle ?? null,
              channelName: item.channelName ?? null,
            })
            .run();
        }

        for (const item of parsed.interactions) {
          const exists = tx
            .select({ id: interactions.id })
            .from(interactions)
            .where(
              and(
                eq(interactions.userId, userId),
                eq(interactions.videoId, item.videoId),
                eq(interactions.type, item.type),
              ),
            )
            .limit(1)
            .all()[0];
          if (exists) continue;
          tx.insert(interactions)
            .values({
              userId,
              videoId: item.videoId,
              channelId: item.channelId,
              type: item.type,
              createdAt: item.createdAt,
            })
            .run();
        }

        for (const item of parsed.subscriptions) {
          tx.insert(subscriptions)
            .values({
              userId,
              channelId: item.channelId,
              subscribedAt: item.subscribedAt,
            })
            .onConflictDoNothing({
              target: [subscriptions.userId, subscriptions.channelId],
            })
            .run();
        }
      });

      return { ok: true };
    }),
});
