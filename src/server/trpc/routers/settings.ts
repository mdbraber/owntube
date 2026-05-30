import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defaultPlaybackQualitySchema } from "@/lib/default-playback-quality";
import { sponsorBlockCategorySchema } from "@/lib/sponsorblock";
import {
  interactions,
  subscriptions,
  userProfile,
  watchHistory,
} from "@/server/db/schema";
import { clearRecommendationCachesForUser } from "@/server/recommendation/engine";
import {
  clearProxyCaches,
  getInstanceSourceInfo,
  resolveEffectiveProxyBases,
} from "@/server/services/proxy";
import {
  appSettingsSchema,
  getUserProxyOverrides,
  getUserSettings,
  upsertUserSettings,
} from "@/server/settings/profile";
import { protectedProcedure, router } from "@/server/trpc/init";

const settingsPatchSchema = z.object({
  theme: appSettingsSchema.shape.theme.optional(),
  pipedBaseUrl: z.string().max(512).optional(),
  invidiousBaseUrl: z.string().max(512).optional(),
  trendingRegion: z.string().length(2).optional(),
  hideRestrictedVideos: z.boolean().optional(),
  defaultCinemaMode: z.boolean().optional(),
  enableMiniPlayer: z.boolean().optional(),
  defaultPlaybackQuality: defaultPlaybackQualitySchema.optional(),
  sponsorBlockEnabled: z.boolean().optional(),
  sponsorBlockAutoSkip: z.boolean().optional(),
  sponsorBlockCategories: z.array(sponsorBlockCategorySchema).optional(),
});

const healthCheckInputSchema = z.object({
  pipedBaseUrl: z.string().max(512).optional(),
  invidiousBaseUrl: z.string().max(512).optional(),
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

async function checkUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

export const settingsRouter = router({
  get: protectedProcedure.query(({ ctx }) => {
    const settings = getUserSettings(ctx.db, ctx.userId);
    return {
      ...settings,
      instanceSources: getInstanceSourceInfo(settings),
    };
  }),

  update: protectedProcedure
    .input(settingsPatchSchema)
    .mutation(({ ctx, input }) =>
      upsertUserSettings(ctx.db, ctx.userId, input),
    ),

  checkInstances: protectedProcedure
    .input(healthCheckInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const current = getUserSettings(ctx.db, ctx.userId);
      const overrides =
        input?.pipedBaseUrl !== undefined ||
        input?.invidiousBaseUrl !== undefined
          ? {
              pipedBaseUrl: input.pipedBaseUrl ?? current.pipedBaseUrl,
              invidiousBaseUrl:
                input.invidiousBaseUrl ?? current.invidiousBaseUrl,
            }
          : getUserProxyOverrides(ctx.db, ctx.userId);
      const { pipedBase, invidiousBase } =
        resolveEffectiveProxyBases(overrides);
      const pipedOk = pipedBase
        ? await checkUrl(`${pipedBase}/trending?region=US`)
        : null;
      const invidiousOk = invidiousBase
        ? await checkUrl(`${invidiousBase}/api/v1/stats`)
        : null;
      return {
        pipedOk,
        invidiousOk,
      };
    }),

  clearCaches: protectedProcedure.mutation(({ ctx }) => {
    const proxy = clearProxyCaches(ctx.db);
    clearRecommendationCachesForUser(ctx.userId);
    return {
      ok: true,
      clearedRows: proxy.clearedRows,
    };
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
