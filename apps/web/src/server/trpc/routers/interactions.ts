import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { interactions } from "@/server/db/schema";
import { clearRecommendationCachesForUser } from "@/server/recommendation/engine";
import { fetchVideoDetail } from "@/server/services/proxy";
import {
  getUserProxyOverrides,
  getUserSettings,
  upsertUserSettings,
} from "@/server/settings/profile";
import { protectedProcedure, router } from "@/server/trpc/init";

const interactionTypeSchema = z.enum(["like", "dislike", "save", "ignore"]);

const setInteractionSchema = z.object({
  videoId: z.string().min(5).max(64),
  channelId: z.string().min(1).max(128).optional(),
  type: interactionTypeSchema,
  active: z.boolean(),
  title: z.string().max(300).optional(),
});

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export const interactionsRouter = router({
  set: protectedProcedure
    .input(setInteractionSchema)
    .mutation(({ ctx, input }) => {
      const ts = nowUnix();
      const existing = ctx.db
        .select()
        .from(interactions)
        .where(
          and(
            eq(interactions.userId, ctx.userId),
            eq(interactions.videoId, input.videoId),
            eq(interactions.type, input.type),
          ),
        )
        .orderBy(desc(interactions.createdAt))
        .limit(1)
        .all()[0];

      if (input.active) {
        if (existing) {
          return { ok: true };
        }
        ctx.db
          .insert(interactions)
          .values({
            userId: ctx.userId,
            videoId: input.videoId,
            channelId: input.channelId ?? null,
            type: input.type,
            createdAt: ts,
            title: input.title ?? null,
          })
          .run();
      } else if (existing) {
        ctx.db
          .delete(interactions)
          .where(eq(interactions.id, existing.id))
          .run();
      }

      clearRecommendationCachesForUser(ctx.userId);
      return { ok: true };
    }),
  state: protectedProcedure
    .input(z.object({ videoId: z.string().min(5).max(64) }))
    .query(({ ctx, input }) => {
      const rows = ctx.db
        .select({ type: interactions.type })
        .from(interactions)
        .where(
          and(
            eq(interactions.userId, ctx.userId),
            eq(interactions.videoId, input.videoId),
          ),
        )
        .all();
      return {
        like: rows.some((row) => row.type === "like"),
        dislike: rows.some((row) => row.type === "dislike"),
        save: rows.some((row) => row.type === "save"),
      };
    }),
  listSaved: protectedProcedure.query(async ({ ctx }) => {
    const rows = ctx.db
      .select({
        videoId: interactions.videoId,
        title: interactions.title,
        channelId: interactions.channelId,
        createdAt: interactions.createdAt,
      })
      .from(interactions)
      .where(
        and(eq(interactions.userId, ctx.userId), eq(interactions.type, "save")),
      )
      .orderBy(desc(interactions.createdAt))
      .all();
    const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
    return Promise.all(
      rows.map(async (r) => {
        try {
          const detail = await fetchVideoDetail(
            ctx.db,
            { videoId: r.videoId },
            overrides,
          );
          return {
            videoId: r.videoId,
            videoTitle: detail.title ?? r.title ?? r.videoId,
            thumbnailUrl: detail.thumbnailUrl,
            durationSeconds: detail.durationSeconds,
            channelId: r.channelId,
            channelName: detail.channelName ?? r.channelId,
            channelAvatarUrl: detail.channelAvatarUrl,
            href: `/watch/${r.videoId}`,
          };
        } catch {
          return {
            videoId: r.videoId,
            videoTitle: r.title ?? r.videoId,
            thumbnailUrl: undefined as string | undefined,
            durationSeconds: undefined as number | undefined,
            channelId: r.channelId,
            channelName: r.channelId,
            channelAvatarUrl: undefined as string | undefined,
            href: `/watch/${r.videoId}`,
          };
        }
      }),
    );
  }),
  /** Lightweight id-only list of saved videos for membership pills (no detail fetch). */
  savedIds: protectedProcedure.query(({ ctx }) => {
    const rows = ctx.db
      .select({ videoId: interactions.videoId })
      .from(interactions)
      .where(
        and(eq(interactions.userId, ctx.userId), eq(interactions.type, "save")),
      )
      .all();
    return rows.map((r) => r.videoId);
  }),
  /** Bounded lookup: which of the given video ids has this user ignored. */
  ignoredAmong: protectedProcedure
    .input(z.object({ videoIds: z.array(z.string().min(1).max(64)).max(200) }))
    .query(({ ctx, input }) => {
      if (input.videoIds.length === 0) return [] as string[];
      const rows = ctx.db
        .select({ videoId: interactions.videoId })
        .from(interactions)
        .where(
          and(
            eq(interactions.userId, ctx.userId),
            eq(interactions.type, "ignore"),
            inArray(interactions.videoId, input.videoIds),
          ),
        )
        .all();
      return rows.map((r) => r.videoId);
    }),
  blockRecommendationChannel: protectedProcedure
    .input(z.object({ channelId: z.string().min(1).max(128) }))
    .mutation(({ ctx, input }) => {
      const settings = getUserSettings(ctx.db, ctx.userId);
      const blocked = new Set(settings.blockedRecommendationChannels);
      blocked.add(input.channelId.trim());
      upsertUserSettings(ctx.db, ctx.userId, {
        blockedRecommendationChannels: [...blocked],
      });
      clearRecommendationCachesForUser(ctx.userId);
      return { ok: true as const };
    }),
  /** Inverse of blockRecommendationChannel — backs the toast's Undo. */
  unblockRecommendationChannel: protectedProcedure
    .input(z.object({ channelId: z.string().min(1).max(128) }))
    .mutation(({ ctx, input }) => {
      const settings = getUserSettings(ctx.db, ctx.userId);
      const blocked = new Set(settings.blockedRecommendationChannels);
      blocked.delete(input.channelId.trim());
      upsertUserSettings(ctx.db, ctx.userId, {
        blockedRecommendationChannels: [...blocked],
      });
      clearRecommendationCachesForUser(ctx.userId);
      return { ok: true as const };
    }),
});
