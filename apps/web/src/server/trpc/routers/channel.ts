import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { newerPublished } from "@/lib/published-sort-key";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { patchVideosWithChannelRss } from "@/server/rss/patch";
import {
  fetchChannelPage,
  fetchRelatedChannels,
} from "@/server/services/proxy";
import {
  fetchChannelPlaylists,
  fetchYtPlaylist,
} from "@/server/services/proxy/channel-playlists";
import { channelPageInputSchema } from "@/server/services/proxy.types";
import { publicProcedure, router } from "@/server/trpc/init";

const channelPageQuerySchema = channelPageInputSchema.extend({
  /** Set by `useInfiniteQuery` from `getNextPageParam` (channel continuation token). */
  cursor: z.string().max(16384).nullish(),
  /**
   * Never block on a live upstream fetch — serve fresh cache, else stale
   * cache, else an empty page. For callers that fire one request per row as
   * focus moves through a list (the TV app's channel rail) rather than one
   * deliberate navigation, where a ~1s+ live fetch per row makes browsing
   * feel frozen.
   */
  cacheOnly: z.boolean().optional(),
});

export const channelRouter = router({
  page: publicProcedure
    .input(channelPageQuerySchema)
    .query(async ({ ctx, input }) => {
      const { cursor, continuation, channelId, tab, cacheOnly } = input;
      try {
        const page = await fetchChannelPage(
          ctx.db,
          {
            channelId,
            tab,
            continuation: continuation ?? cursor ?? undefined,
          },
          cacheOnly ? { cacheOnly: true } : undefined,
        );
        // Upstream dates here are derived from YouTube's coarse relative text
        // at request time and its view counts are sometimes 0 — see
        // patchVideosWithChannelRss. The subscriptions feed already corrected
        // for this; a channel's own page showed the raw values.
        const videos = await patchVideosWithChannelRss(ctx.db, page.videos);
        // Re-sort within the page, as the merged feed does after the same
        // patch. Upstream ordered this list by the dates we just replaced, so a
        // row whose date was wrong sits in the wrong place — most visibly the
        // one dated "now" that upstream therefore put first.
        const nowSec = Math.floor(Date.now() / 1000);
        return {
          ...page,
          videos: [...videos].sort((a, b) => newerPublished(a, b, nowSec)),
        };
      } catch (e) {
        if (e instanceof UpstreamUnavailableError) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
        }
        if (e instanceof RateLimitExceededError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: e.message,
          });
        }
        throw e;
      }
    }),

  /** Suggested "similar" channels (Similar tab) derived from relatedness. */
  relatedChannels: publicProcedure
    .input(z.object({ channelId: z.string().min(3).max(128) }))
    .query(async ({ ctx, input }) => {
      try {
        return await fetchRelatedChannels(ctx.db, input.channelId);
      } catch (e) {
        if (e instanceof UpstreamUnavailableError) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
        }
        if (e instanceof RateLimitExceededError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: e.message,
          });
        }
        throw e;
      }
    }),

  /** The channel's public YouTube playlists (Playlists tab). */
  playlists: publicProcedure
    .input(z.object({ channelId: z.string().min(3).max(128) }))
    .query(async ({ input }) => {
      try {
        return await fetchChannelPlaylists({ channelId: input.channelId });
      } catch (e) {
        if (e instanceof UpstreamUnavailableError) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
        }
        if (e instanceof RateLimitExceededError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: e.message,
          });
        }
        throw e;
      }
    }),

  /** A public YouTube playlist (metadata + first page of videos). */
  ytPlaylist: publicProcedure
    .input(z.object({ playlistId: z.string().min(5).max(128) }))
    .query(async ({ input }) => {
      try {
        return await fetchYtPlaylist({ playlistId: input.playlistId });
      } catch (e) {
        if (e instanceof UpstreamUnavailableError) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: e.message });
        }
        if (e instanceof RateLimitExceededError) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: e.message,
          });
        }
        throw e;
      }
    }),
});
