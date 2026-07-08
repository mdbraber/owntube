import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { CHANNEL_TAG_MAX_LEN, normalizeChannelTag } from "@/lib/channel-tag";
import type { AppDb } from "@/server/db/client";
import { channelTags } from "@/server/db/schema";
import { protectedProcedure, router } from "@/server/trpc/init";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

const channelIdSchema = z.string().min(1).max(128);
const rawTagSchema = z
  .string()
  .min(1)
  .max(CHANNEL_TAG_MAX_LEN + 8);

/**
 * Per-user local channel tags. A channel can hold many tags; tags are private
 * to the user and never leave this instance. Used by the channel page (add /
 * remove pills), the subscriptions tag filter, and `#tag` search.
 */
export const channelTagsRouter = router({
  /** Tags on one channel, alphabetically. */
  listForChannel: protectedProcedure
    .input(z.object({ channelId: channelIdSchema }))
    .query(({ ctx, input }) => {
      const rows = ctx.db
        .select({ tag: channelTags.tag })
        .from(channelTags)
        .where(
          and(
            eq(channelTags.userId, ctx.userId),
            eq(channelTags.channelId, input.channelId),
          ),
        )
        .orderBy(asc(channelTags.tag))
        .all();
      return rows.map((r) => r.tag);
    }),

  /** Every distinct tag the user has, with how many channels carry it. */
  listAll: protectedProcedure.query(({ ctx }) => {
    const rows = ctx.db
      .select({
        tag: channelTags.tag,
        count: sql<number>`count(distinct ${channelTags.channelId})`,
      })
      .from(channelTags)
      .where(eq(channelTags.userId, ctx.userId))
      .groupBy(channelTags.tag)
      .orderBy(asc(channelTags.tag))
      .all();
    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }),

  /** Every (channelId, tag) pair — backs grouping on the channels list. */
  assignments: protectedProcedure.query(({ ctx }) => {
    return ctx.db
      .select({ channelId: channelTags.channelId, tag: channelTags.tag })
      .from(channelTags)
      .where(eq(channelTags.userId, ctx.userId))
      .orderBy(asc(channelTags.tag))
      .all();
  }),

  /** Channel IDs carrying a given tag (for feed filtering + `#tag` search). */
  channelsForTag: protectedProcedure
    .input(z.object({ tag: rawTagSchema }))
    .query(({ ctx, input }) => {
      const tag = normalizeChannelTag(input.tag);
      if (!tag) return [] as string[];
      const rows = ctx.db
        .select({ channelId: channelTags.channelId })
        .from(channelTags)
        .where(
          and(eq(channelTags.userId, ctx.userId), eq(channelTags.tag, tag)),
        )
        .all();
      return rows.map((r) => r.channelId);
    }),

  /** Add a tag to a channel (idempotent). Returns the channel's tags after. */
  add: protectedProcedure
    .input(z.object({ channelId: channelIdSchema, tag: rawTagSchema }))
    .mutation(({ ctx, input }) => {
      const tag = normalizeChannelTag(input.tag);
      if (!tag)
        return { tags: currentTags(ctx.db, ctx.userId, input.channelId) };
      ctx.db
        .insert(channelTags)
        .values({
          userId: ctx.userId,
          channelId: input.channelId,
          tag,
          createdAt: nowUnix(),
        })
        .onConflictDoNothing()
        .run();
      return { tags: currentTags(ctx.db, ctx.userId, input.channelId) };
    }),

  /** Remove a tag from a channel. Returns the channel's tags after. */
  remove: protectedProcedure
    .input(z.object({ channelId: channelIdSchema, tag: rawTagSchema }))
    .mutation(({ ctx, input }) => {
      const tag = normalizeChannelTag(input.tag);
      if (tag) {
        ctx.db
          .delete(channelTags)
          .where(
            and(
              eq(channelTags.userId, ctx.userId),
              eq(channelTags.channelId, input.channelId),
              eq(channelTags.tag, tag),
            ),
          )
          .run();
      }
      return { tags: currentTags(ctx.db, ctx.userId, input.channelId) };
    }),
});

function currentTags(db: AppDb, userId: number, channelId: string): string[] {
  return db
    .select({ tag: channelTags.tag })
    .from(channelTags)
    .where(
      and(eq(channelTags.userId, userId), eq(channelTags.channelId, channelId)),
    )
    .orderBy(asc(channelTags.tag))
    .all()
    .map((r) => r.tag);
}
