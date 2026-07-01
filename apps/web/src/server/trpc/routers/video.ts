import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamAgeRestrictedError } from "@/server/errors/upstream-age-restricted";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import {
  fetchRelatedVideos,
  fetchVideoComments,
  fetchVideoDetail,
} from "@/server/services/proxy";
import {
  videoCommentsInputSchema,
  videoDetailInputSchema,
} from "@/server/services/proxy.types";
import { getUserProxyOverrides } from "@/server/settings/profile";
import { publicProcedure, router } from "@/server/trpc/init";

const videoCommentsQuerySchema = videoCommentsInputSchema.extend({
  /** Set by `useInfiniteQuery` from `getNextPageParam`. */
  cursor: z.string().max(16384).nullish(),
});

export const videoRouter = router({
  detail: publicProcedure
    .input(videoDetailInputSchema)
    .query(async ({ ctx, input }) => {
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      try {
        return await fetchVideoDetail(ctx.db, input, overrides, {
          preferUpstream: input.preferUpstream,
        });
      } catch (e) {
        if (e instanceof UpstreamAgeRestrictedError) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: e.message,
          });
        }
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
  related: publicProcedure
    .input(videoDetailInputSchema)
    .query(async ({ ctx, input }) => {
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      return fetchRelatedVideos(ctx.db, input, 20, overrides);
    }),
  comments: publicProcedure
    .input(videoCommentsQuerySchema)
    .query(async ({ ctx, input }) => {
      const { cursor, continuation, videoId, sortBy } = input;
      try {
        const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
        return await fetchVideoComments(
          ctx.db,
          {
            videoId,
            sortBy,
            continuation: continuation ?? cursor ?? undefined,
          },
          overrides,
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
});
