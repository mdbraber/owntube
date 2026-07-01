import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { playlistItems, playlists } from "@/server/db/schema";
import { protectedProcedure, router } from "@/server/trpc/init";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

const playlistInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

export const playlistsRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    const lists = ctx.db
      .select({
        id: playlists.id,
        name: playlists.name,
        description: playlists.description,
        createdAt: playlists.createdAt,
        updatedAt: playlists.updatedAt,
      })
      .from(playlists)
      .where(eq(playlists.userId, ctx.userId))
      .orderBy(desc(playlists.updatedAt))
      .all();

    const ids = lists.map((l) => l.id);
    const counts = ids.length
      ? ctx.db
          .select({
            playlistId: playlistItems.playlistId,
          })
          .from(playlistItems)
          .where(inArray(playlistItems.playlistId, ids))
          .all()
      : [];

    const byPlaylist = new Map<number, number>();
    for (const row of counts) {
      byPlaylist.set(row.playlistId, (byPlaylist.get(row.playlistId) ?? 0) + 1);
    }

    return lists.map((p) => ({
      ...p,
      itemCount: byPlaylist.get(p.id) ?? 0,
    }));
  }),

  create: protectedProcedure
    .input(playlistInputSchema)
    .mutation(({ ctx, input }) => {
      const ts = nowUnix();
      const created = ctx.db
        .insert(playlists)
        .values({
          userId: ctx.userId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          createdAt: ts,
          updatedAt: ts,
        })
        .returning({ id: playlists.id })
        .get();
      return { id: created.id };
    }),

  rename: protectedProcedure
    .input(
      z.object({
        playlistId: z.number().int().positive(),
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      ctx.db
        .update(playlists)
        .set({
          name: input.name.trim(),
          description: input.description?.trim() || null,
          updatedAt: nowUnix(),
        })
        .where(
          and(
            eq(playlists.id, input.playlistId),
            eq(playlists.userId, ctx.userId),
          ),
        )
        .run();
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ playlistId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .delete(playlists)
        .where(
          and(
            eq(playlists.id, input.playlistId),
            eq(playlists.userId, ctx.userId),
          ),
        )
        .run();
      return { ok: true };
    }),

  items: protectedProcedure
    .input(z.object({ playlistId: z.number().int().positive() }))
    .query(({ ctx, input }) => {
      const owner = ctx.db
        .select({ id: playlists.id })
        .from(playlists)
        .where(
          and(
            eq(playlists.id, input.playlistId),
            eq(playlists.userId, ctx.userId),
          ),
        )
        .limit(1)
        .all()[0];
      if (!owner) return { items: [] };
      const items = ctx.db
        .select({
          id: playlistItems.id,
          videoId: playlistItems.videoId,
          channelId: playlistItems.channelId,
          addedAt: playlistItems.addedAt,
        })
        .from(playlistItems)
        .where(eq(playlistItems.playlistId, input.playlistId))
        .orderBy(asc(playlistItems.addedAt))
        .all();
      return { items };
    }),

  addItem: protectedProcedure
    .input(
      z.object({
        playlistId: z.number().int().positive(),
        videoId: z.string().min(5).max(64),
        channelId: z.string().max(128).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const owner = ctx.db
        .select({ id: playlists.id })
        .from(playlists)
        .where(
          and(
            eq(playlists.id, input.playlistId),
            eq(playlists.userId, ctx.userId),
          ),
        )
        .limit(1)
        .all()[0];
      if (!owner) return { ok: false as const };

      const ts = nowUnix();
      ctx.db
        .insert(playlistItems)
        .values({
          playlistId: input.playlistId,
          videoId: input.videoId,
          channelId: input.channelId ?? null,
          addedAt: ts,
        })
        .onConflictDoNothing({
          target: [playlistItems.playlistId, playlistItems.videoId],
        })
        .run();

      ctx.db
        .update(playlists)
        .set({ updatedAt: ts })
        .where(eq(playlists.id, input.playlistId))
        .run();
      return { ok: true as const };
    }),

  removeItem: protectedProcedure
    .input(
      z.object({
        playlistId: z.number().int().positive(),
        videoId: z.string().min(5).max(64),
      }),
    )
    .mutation(({ ctx, input }) => {
      const owner = ctx.db
        .select({ id: playlists.id })
        .from(playlists)
        .where(
          and(
            eq(playlists.id, input.playlistId),
            eq(playlists.userId, ctx.userId),
          ),
        )
        .limit(1)
        .all()[0];
      if (!owner) return { ok: false as const };

      ctx.db
        .delete(playlistItems)
        .where(
          and(
            eq(playlistItems.playlistId, input.playlistId),
            eq(playlistItems.videoId, input.videoId),
          ),
        )
        .run();

      ctx.db
        .update(playlists)
        .set({ updatedAt: nowUnix() })
        .where(eq(playlists.id, input.playlistId))
        .run();
      return { ok: true as const };
    }),
});
