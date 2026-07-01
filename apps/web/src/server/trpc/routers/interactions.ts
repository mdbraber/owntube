import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { interactions } from "@/server/db/schema";
import { clearRecommendationCachesForUser } from "@/server/recommendation/engine";
import { getUserSettings, upsertUserSettings } from "@/server/settings/profile";
import { protectedProcedure, router } from "@/server/trpc/init";

const interactionTypeSchema = z.enum(["like", "dislike", "save"]);

const setInteractionSchema = z.object({
  videoId: z.string().min(5).max(64),
  channelId: z.string().min(1).max(128).optional(),
  type: interactionTypeSchema,
  active: z.boolean(),
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
});
