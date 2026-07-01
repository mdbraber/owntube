import { and, desc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { watchHistory } from "@/server/db/schema";
import { clearRecommendationCachesForUser } from "@/server/recommendation/engine";
import { loadWatchedVideoIdsForRecommendations } from "@/server/recommendation/watched-videos";
import { fetchVideoDetail } from "@/server/services/proxy";
import { getUserProxyOverrides } from "@/server/settings/profile";
import { protectedProcedure, router } from "@/server/trpc/init";

const historyEventInputSchema = z.object({
  videoId: z.string().min(5).max(64),
  channelId: z.string().min(1).max(128),
  durationWatched: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24)
    .default(0),
  completed: z.boolean().default(false),
  /** Total video length; 0 = unknown. Rows with 0 are excluded from engagement-weighted signals. */
  videoDurationSeconds: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 24)
    .default(0),
  /** Recorded from the Shorts feed — kept out of the long-form recommendation signal. */
  isShort: z.boolean().default(false),
});

const historyPageInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(128).optional(),
});

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export const historyRouter = router({
  watchedVideoIds: protectedProcedure.query(({ ctx }) => {
    return [...loadWatchedVideoIdsForRecommendations(ctx.db, ctx.userId)];
  }),
  upsertEvent: protectedProcedure
    .input(historyEventInputSchema)
    .mutation(async ({ ctx, input }) => {
      const ts = nowUnix();
      const recent = ctx.db
        .select()
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, ctx.userId),
            eq(watchHistory.videoId, input.videoId),
            eq(watchHistory.isDeleted, 0),
          ),
        )
        .orderBy(desc(watchHistory.startedAt))
        .limit(1)
        .all()[0];

      if (recent && ts - recent.startedAt < 30 * 60) {
        const duration = Math.max(
          recent.durationWatched,
          input.durationWatched,
        );
        const completed = recent.completed || (input.completed ? 1 : 0);
        ctx.db
          .update(watchHistory)
          .set({
            durationWatched: duration,
            completed,
            videoDurationSeconds: Math.max(
              recent.videoDurationSeconds,
              input.videoDurationSeconds,
            ),
            createdAt: ts,
          })
          .where(eq(watchHistory.id, recent.id))
          .run();
        if (input.completed) {
          clearRecommendationCachesForUser(ctx.userId);
        }
        return { id: recent.id, updated: true };
      }

      const inserted = ctx.db
        .insert(watchHistory)
        .values({
          userId: ctx.userId,
          videoId: input.videoId,
          channelId: input.channelId,
          startedAt: ts,
          durationWatched: input.durationWatched,
          completed: input.completed ? 1 : 0,
          videoDurationSeconds: input.videoDurationSeconds,
          isDeleted: 0,
          isShort: input.isShort ? 1 : 0,
          createdAt: ts,
        })
        .returning({ id: watchHistory.id })
        .get();
      if (input.completed) {
        clearRecommendationCachesForUser(ctx.userId);
      }
      return { id: inserted.id, updated: false };
    }),
  list: protectedProcedure
    .input(historyPageInputSchema)
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.pageSize;
      const q = input.q?.trim();
      const baseWhere = and(
        eq(watchHistory.userId, ctx.userId),
        eq(watchHistory.isDeleted, 0),
      );
      const where = q
        ? and(
            baseWhere,
            or(
              like(watchHistory.videoId, `%${q}%`),
              like(watchHistory.channelId, `%${q}%`),
            ),
          )
        : baseWhere;
      const rows = ctx.db
        .select({
          id: watchHistory.id,
          videoId: watchHistory.videoId,
          channelId: watchHistory.channelId,
          startedAt: watchHistory.startedAt,
          durationWatched: watchHistory.durationWatched,
          completed: watchHistory.completed,
        })
        .from(watchHistory)
        .where(where)
        .orderBy(desc(watchHistory.startedAt))
        .limit(input.pageSize)
        .offset(offset)
        .all();
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      const enriched = await Promise.all(
        rows.map(async (row) => {
          try {
            const detail = await fetchVideoDetail(
              ctx.db,
              { videoId: row.videoId },
              overrides,
            );
            return {
              ...row,
              videoTitle: detail.title,
              thumbnailUrl: detail.thumbnailUrl,
              channelName: detail.channelName ?? row.channelId,
            };
          } catch {
            return {
              ...row,
              videoTitle: row.videoId,
              thumbnailUrl: undefined,
              channelName: row.channelId,
            };
          }
        }),
      );
      return enriched;
    }),
  softDelete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .update(watchHistory)
        .set({ isDeleted: 1 })
        .where(
          and(
            eq(watchHistory.id, input.id),
            eq(watchHistory.userId, ctx.userId),
          ),
        )
        .run();
      return { ok: true };
    }),
});
