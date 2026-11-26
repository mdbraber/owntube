import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  fetchRelatedVideos,
  fetchVideoComments,
  fetchVideoDetail,
} from "@/server/catalog";
import {
  videoCommentsInputSchema,
  videoDetailInputSchema,
} from "@/server/catalog/types";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamAgeRestrictedError } from "@/server/errors/upstream-age-restricted";
import { UpstreamLiveUpcomingError } from "@/server/errors/upstream-live-upcoming";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { UpstreamVideoUnavailableError } from "@/server/errors/upstream-video-unavailable";
import {
  getUserSettings,
  withoutBlockedChannels,
} from "@/server/settings/profile";
import { publicProcedure, router } from "@/server/trpc/init";

const videoCommentsQuerySchema = videoCommentsInputSchema.extend({
  /** Set by `useInfiniteQuery` from `getNextPageParam`. */
  cursor: z.string().max(16384).nullish(),
});

export const videoRouter = router({
  detail: publicProcedure
    .input(videoDetailInputSchema)
    .query(async ({ input }) => {
      try {
        return await fetchVideoDetail(input);
      } catch (e) {
        if (e instanceof UpstreamAgeRestrictedError) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: e.message,
          });
        }
        if (e instanceof UpstreamLiveUpcomingError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: e.message,
            cause: e,
          });
        }
        if (e instanceof UpstreamVideoUnavailableError) {
          throw new TRPCError({ code: "NOT_FOUND", message: e.message });
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
      const result = await fetchRelatedVideos(input, 20);
      if (!ctx.userId) return result;
      return {
        ...result,
        videos: withoutBlockedChannels(
          result.videos,
          getUserSettings(ctx.db, ctx.userId),
        ),
      };
    }),
  comments: publicProcedure
    .input(videoCommentsQuerySchema)
    .query(async ({ ctx, input }) => {
      const { cursor, continuation, videoId, sortBy } = input;
      try {
        return await fetchVideoComments(
          {
            videoId,
            sortBy,
            continuation: continuation ?? cursor ?? undefined,
          },
          ctx.prefetchCacheOnly ? { cache: "only" } : {},
        );
      } catch (e) {
        if (e instanceof UpstreamLiveUpcomingError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: e.message,
            cause: e,
          });
        }
        if (e instanceof UpstreamVideoUnavailableError) {
          throw new TRPCError({ code: "NOT_FOUND", message: e.message });
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
});
