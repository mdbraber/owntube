import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  fetchChannelPage,
  fetchChannelPlaylists,
  fetchYtPlaylist,
} from "@/server/catalog";
import { fetchRelatedChannels } from "@/server/catalog/related-channels";
import { channelPageInputSchema } from "@/server/catalog/types";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
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
    .query(async ({ input }) => {
      const { cursor, continuation, channelId, tab, cacheOnly } = input;
      try {
        return await fetchChannelPage(
          {
            channelId,
            tab,
            continuation: continuation ?? cursor ?? undefined,
          },
          cacheOnly ? { cache: "only" } : undefined,
        );
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
