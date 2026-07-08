import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { watchQueue } from "@/server/db/schema";
import { fetchVideoDetail } from "@/server/services/proxy";
import { getUserProxyOverrides } from "@/server/settings/profile";
import { protectedProcedure, router } from "@/server/trpc/init";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

const videoIdSchema = z.string().min(1).max(64);

/**
 * Server-backed, per-user watch queue. Ordered by `position`; the client mirrors
 * it into localStorage["ot:watch-queue"] so the player's Up-next and the iOS
 * widget keep working from the same data.
 */
export const queueRouter = router({
  /** Lightweight list (used by the toggle button + localStorage sync). */
  list: protectedProcedure.query(({ ctx }) => {
    const items = ctx.db
      .select({
        videoId: watchQueue.videoId,
        title: watchQueue.title,
        channelId: watchQueue.channelId,
        position: watchQueue.position,
        addedAt: watchQueue.addedAt,
      })
      .from(watchQueue)
      .where(eq(watchQueue.userId, ctx.userId))
      .orderBy(asc(watchQueue.position))
      .all();
    return items.map((i) => ({ ...i, href: `/watch/${i.videoId}` }));
  }),

  /** Enriched list (title/channel/thumbnail) for the /queue page. */
  listDetailed: protectedProcedure.query(async ({ ctx }) => {
    const items = ctx.db
      .select({
        videoId: watchQueue.videoId,
        title: watchQueue.title,
        channelId: watchQueue.channelId,
        position: watchQueue.position,
      })
      .from(watchQueue)
      .where(eq(watchQueue.userId, ctx.userId))
      .orderBy(asc(watchQueue.position))
      .all();
    const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
    return Promise.all(
      items.map(async (row) => {
        try {
          const detail = await fetchVideoDetail(
            ctx.db,
            { videoId: row.videoId },
            overrides,
          );
          return {
            videoId: row.videoId,
            position: row.position,
            videoTitle: detail.title ?? row.title,
            thumbnailUrl: detail.thumbnailUrl,
            durationSeconds: detail.durationSeconds,
            channelId: row.channelId,
            channelName: detail.channelName ?? row.channelId,
          };
        } catch {
          return {
            videoId: row.videoId,
            position: row.position,
            videoTitle: row.title,
            thumbnailUrl: undefined as string | undefined,
            durationSeconds: undefined as number | undefined,
            channelId: row.channelId,
            channelName: row.channelId,
          };
        }
      }),
    );
  }),

  add: protectedProcedure
    .input(
      z.object({
        videoId: videoIdSchema,
        title: z.string().min(1).max(300),
        channelId: z.string().max(128).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const rows = ctx.db
        .select({ position: watchQueue.position })
        .from(watchQueue)
        .where(eq(watchQueue.userId, ctx.userId))
        .all();
      const nextPos = rows.reduce((m, r) => Math.max(m, r.position), -1) + 1;
      ctx.db
        .insert(watchQueue)
        .values({
          userId: ctx.userId,
          videoId: input.videoId,
          title: input.title.trim().slice(0, 300),
          channelId: input.channelId ?? null,
          position: nextPos,
          addedAt: nowUnix(),
        })
        .onConflictDoNothing({
          target: [watchQueue.userId, watchQueue.videoId],
        })
        .run();
      return { ok: true as const };
    }),

  remove: protectedProcedure
    .input(z.object({ videoId: videoIdSchema }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .delete(watchQueue)
        .where(
          and(
            eq(watchQueue.userId, ctx.userId),
            eq(watchQueue.videoId, input.videoId),
          ),
        )
        .run();
      return { ok: true as const };
    }),

  reorder: protectedProcedure
    .input(z.object({ videoIds: z.array(videoIdSchema).max(500) }))
    .mutation(({ ctx, input }) => {
      ctx.db.transaction((tx) => {
        input.videoIds.forEach((vid, idx) => {
          tx.update(watchQueue)
            .set({ position: idx })
            .where(
              and(
                eq(watchQueue.userId, ctx.userId),
                eq(watchQueue.videoId, vid),
              ),
            )
            .run();
        });
      });
      return { ok: true as const };
    }),

  clear: protectedProcedure.mutation(({ ctx }) => {
    ctx.db.delete(watchQueue).where(eq(watchQueue.userId, ctx.userId)).run();
    return { ok: true as const };
  }),
});
