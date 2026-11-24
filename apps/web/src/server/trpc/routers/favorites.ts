import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { normalizeYoutubeChannelId } from "@/lib/youtube-channel-id";
import { channelTags, subscriptions } from "@/server/db/schema";
import { getUserSettings } from "@/server/settings/profile";
import { subscribeToChannel } from "@/server/subscriptions/subscribe";
import { protectedProcedure, router } from "@/server/trpc/init";

const channelIdSchema = z.string().min(1).max(128);

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Favorites are subscribed channels carrying the user's favorite tag
 * (settings.favoriteTag, "favorite" by default). The star button goes through
 * here so starring an unsubscribed channel subscribes to it as well.
 */
export const favoritesRouter = router({
  /** Whether a channel is a favorite (and subscribed), plus the tag in use. */
  status: protectedProcedure
    .input(z.object({ channelId: channelIdSchema }))
    .query(({ ctx, input }) => {
      const tag = getUserSettings(ctx.db, ctx.userId).favoriteTag;
      const ids = [input.channelId, normalizeYoutubeChannelId(input.channelId)];
      const tagged = ctx.db
        .select({ id: channelTags.id })
        .from(channelTags)
        .where(
          and(
            eq(channelTags.userId, ctx.userId),
            eq(channelTags.tag, tag),
            or(...ids.map((id) => eq(channelTags.channelId, id))),
          ),
        )
        .limit(1)
        .all()[0];
      const subscribed = ctx.db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, ctx.userId),
            or(...ids.map((id) => eq(subscriptions.channelId, id))),
          ),
        )
        .limit(1)
        .all()[0];
      return { favorite: Boolean(tagged && subscribed), tag };
    }),

  /**
   * Star / unstar a channel. Starring subscribes first; unstarring only
   * removes the tag and leaves the subscription alone.
   */
  set: protectedProcedure
    .input(z.object({ channelId: channelIdSchema, favorite: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const tag = getUserSettings(ctx.db, ctx.userId).favoriteTag;
      const channelId = normalizeYoutubeChannelId(input.channelId);
      if (input.favorite) {
        await subscribeToChannel(ctx.db, ctx.userId, channelId);
        ctx.db
          .insert(channelTags)
          .values({
            userId: ctx.userId,
            channelId,
            tag,
            createdAt: nowUnix(),
          })
          .onConflictDoNothing()
          .run();
      } else {
        ctx.db
          .delete(channelTags)
          .where(
            and(
              eq(channelTags.userId, ctx.userId),
              eq(channelTags.tag, tag),
              or(
                eq(channelTags.channelId, input.channelId),
                eq(channelTags.channelId, channelId),
              ),
            ),
          )
          .run();
      }
      return { favorite: input.favorite, tag };
    }),
});
