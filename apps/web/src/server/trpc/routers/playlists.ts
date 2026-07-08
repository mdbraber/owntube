import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { CHANNEL_TAG_MAX_LEN, normalizeChannelTag } from "@/lib/channel-tag";
import type { AppDb } from "@/server/db/client";
import { playlistItems, playlists, playlistTags } from "@/server/db/schema";
import { fetchVideoDetail } from "@/server/services/proxy";
import { getUserProxyOverrides } from "@/server/settings/profile";
import { protectedProcedure, router } from "@/server/trpc/init";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

const playlistInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

const rawTagSchema = z
  .string()
  .min(1)
  .max(CHANNEL_TAG_MAX_LEN + 8);

function ownedPlaylist(db: AppDb, userId: number, playlistId: number) {
  return db
    .select({ id: playlists.id })
    .from(playlists)
    .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
    .limit(1)
    .all()[0];
}

function playlistTagRows(db: AppDb, userId: number, playlistId: number) {
  return db
    .select({ tag: playlistTags.tag })
    .from(playlistTags)
    .where(
      and(
        eq(playlistTags.userId, userId),
        eq(playlistTags.playlistId, playlistId),
      ),
    )
    .orderBy(asc(playlistTags.tag))
    .all()
    .map((r) => r.tag);
}

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

    // First four items per playlist for the overview collage, plus tags.
    const previewByPlaylist = new Map<number, string[]>();
    if (ids.length) {
      const rows = ctx.db
        .select({
          playlistId: playlistItems.playlistId,
          videoId: playlistItems.videoId,
        })
        .from(playlistItems)
        .where(inArray(playlistItems.playlistId, ids))
        .orderBy(asc(playlistItems.position), asc(playlistItems.addedAt))
        .all();
      for (const row of rows) {
        const list = previewByPlaylist.get(row.playlistId) ?? [];
        if (list.length < 4) {
          list.push(row.videoId);
          previewByPlaylist.set(row.playlistId, list);
        }
      }
    }
    const tagsByPlaylist = new Map<number, string[]>();
    if (ids.length) {
      const rows = ctx.db
        .select({ playlistId: playlistTags.playlistId, tag: playlistTags.tag })
        .from(playlistTags)
        .where(
          and(
            eq(playlistTags.userId, ctx.userId),
            inArray(playlistTags.playlistId, ids),
          ),
        )
        .orderBy(asc(playlistTags.tag))
        .all();
      for (const row of rows) {
        const list = tagsByPlaylist.get(row.playlistId) ?? [];
        list.push(row.tag);
        tagsByPlaylist.set(row.playlistId, list);
      }
    }

    return lists.map((p) => ({
      ...p,
      itemCount: byPlaylist.get(p.id) ?? 0,
      previewVideoIds: previewByPlaylist.get(p.id) ?? [],
      tags: tagsByPlaylist.get(p.id) ?? [],
    }));
  }),

  /** One playlist with tags + count — the detail page header. */
  detail: protectedProcedure
    .input(z.object({ playlistId: z.number().int().positive() }))
    .query(({ ctx, input }) => {
      const row = ctx.db
        .select({
          id: playlists.id,
          name: playlists.name,
          description: playlists.description,
          createdAt: playlists.createdAt,
          updatedAt: playlists.updatedAt,
        })
        .from(playlists)
        .where(
          and(
            eq(playlists.id, input.playlistId),
            eq(playlists.userId, ctx.userId),
          ),
        )
        .limit(1)
        .all()[0];
      if (!row) return null;
      const count = ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(playlistItems)
        .where(eq(playlistItems.playlistId, input.playlistId))
        .all()[0];
      return {
        ...row,
        itemCount: Number(count?.n ?? 0),
        tags: playlistTagRows(ctx.db, ctx.userId, input.playlistId),
      };
    }),

  /**
   * Lightweight membership map for status pills: every playlisted video the
   * user has, with its playlist name. Videos in multiple playlists appear once
   * per playlist (most recently added first) — the client keeps the first.
   */
  membership: protectedProcedure.query(({ ctx }) => {
    return ctx.db
      .select({
        videoId: playlistItems.videoId,
        playlistId: playlistItems.playlistId,
        playlistName: playlists.name,
      })
      .from(playlistItems)
      .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
      .where(eq(playlists.userId, ctx.userId))
      .orderBy(desc(playlistItems.addedAt))
      .all();
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
        .orderBy(asc(playlistItems.position), asc(playlistItems.addedAt))
        .all();
      return { items };
    }),

  /** Items with upstream title/thumbnail/duration — the detail page list. */
  itemsDetailed: protectedProcedure
    .input(z.object({ playlistId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (!ownedPlaylist(ctx.db, ctx.userId, input.playlistId)) return [];
      const rows = ctx.db
        .select({
          videoId: playlistItems.videoId,
          channelId: playlistItems.channelId,
        })
        .from(playlistItems)
        .where(eq(playlistItems.playlistId, input.playlistId))
        .orderBy(asc(playlistItems.position), asc(playlistItems.addedAt))
        .all();
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      return Promise.all(
        rows.map(async (row) => {
          try {
            const detail = await fetchVideoDetail(
              ctx.db,
              { videoId: row.videoId },
              overrides,
            );
            return {
              videoId: row.videoId,
              videoTitle: detail.title ?? row.videoId,
              thumbnailUrl: detail.thumbnailUrl,
              durationSeconds: detail.durationSeconds,
              channelId: row.channelId,
              channelName: detail.channelName ?? row.channelId,
              channelAvatarUrl: detail.channelAvatarUrl,
            };
          } catch {
            return {
              videoId: row.videoId,
              videoTitle: row.videoId,
              thumbnailUrl: undefined as string | undefined,
              durationSeconds: undefined as number | undefined,
              channelId: row.channelId,
              channelName: row.channelId,
              channelAvatarUrl: undefined as string | undefined,
            };
          }
        }),
      );
    }),

  /** Persist a drag reorder: positions follow the given video id order. */
  reorderItems: protectedProcedure
    .input(
      z.object({
        playlistId: z.number().int().positive(),
        videoIds: z.array(z.string().min(5).max(64)).max(1000),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!ownedPlaylist(ctx.db, ctx.userId, input.playlistId)) {
        return { ok: false as const };
      }
      ctx.db.transaction((tx) => {
        input.videoIds.forEach((vid, idx) => {
          tx.update(playlistItems)
            .set({ position: idx })
            .where(
              and(
                eq(playlistItems.playlistId, input.playlistId),
                eq(playlistItems.videoId, vid),
              ),
            )
            .run();
        });
      });
      return { ok: true as const };
    }),

  /** Tags on one playlist (same idea + normalizer as channel tags). */
  tags: protectedProcedure
    .input(z.object({ playlistId: z.number().int().positive() }))
    .query(({ ctx, input }) => {
      return playlistTagRows(ctx.db, ctx.userId, input.playlistId);
    }),

  /** Every distinct playlist tag with usage counts (picker suggestions). */
  allTags: protectedProcedure.query(({ ctx }) => {
    const rows = ctx.db
      .select({
        tag: playlistTags.tag,
        count: sql<number>`count(distinct ${playlistTags.playlistId})`,
      })
      .from(playlistTags)
      .where(eq(playlistTags.userId, ctx.userId))
      .groupBy(playlistTags.tag)
      .orderBy(asc(playlistTags.tag))
      .all();
    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }),

  addTag: protectedProcedure
    .input(
      z.object({ playlistId: z.number().int().positive(), tag: rawTagSchema }),
    )
    .mutation(({ ctx, input }) => {
      const tag = normalizeChannelTag(input.tag);
      if (tag && ownedPlaylist(ctx.db, ctx.userId, input.playlistId)) {
        ctx.db
          .insert(playlistTags)
          .values({
            userId: ctx.userId,
            playlistId: input.playlistId,
            tag,
            createdAt: nowUnix(),
          })
          .onConflictDoNothing()
          .run();
      }
      return { tags: playlistTagRows(ctx.db, ctx.userId, input.playlistId) };
    }),

  removeTag: protectedProcedure
    .input(
      z.object({ playlistId: z.number().int().positive(), tag: rawTagSchema }),
    )
    .mutation(({ ctx, input }) => {
      const tag = normalizeChannelTag(input.tag);
      if (tag) {
        ctx.db
          .delete(playlistTags)
          .where(
            and(
              eq(playlistTags.userId, ctx.userId),
              eq(playlistTags.playlistId, input.playlistId),
              eq(playlistTags.tag, tag),
            ),
          )
          .run();
      }
      return { tags: playlistTagRows(ctx.db, ctx.userId, input.playlistId) };
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
      const maxPos = ctx.db
        .select({
          n: sql<number>`coalesce(max(${playlistItems.position}), -1)`,
        })
        .from(playlistItems)
        .where(eq(playlistItems.playlistId, input.playlistId))
        .all()[0];
      ctx.db
        .insert(playlistItems)
        .values({
          playlistId: input.playlistId,
          videoId: input.videoId,
          channelId: input.channelId ?? null,
          addedAt: ts,
          position: Number(maxPos?.n ?? -1) + 1,
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
