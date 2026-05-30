import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prepareShortsFeedVideos } from "@/lib/shorts-feed-presentation";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { clearRecommendationCachesForUser } from "@/server/recommendation/engine";
import { fetchShortsFeedForViewer } from "@/server/recommendation/shorts-feed";
import {
  loadShortSeenVideoIds,
  recordShortSeen,
} from "@/server/recommendation/shorts-seen";
import { describeUpstreamAvailability } from "@/server/services/proxy";
import { shortsFeedInputSchema } from "@/server/services/proxy.types";
import {
  getUserProxyOverrides,
  getUserSettings,
  normalizeTrendingRegionStored,
} from "@/server/settings/profile";
import {
  protectedProcedure,
  publicProcedure,
  router,
} from "@/server/trpc/init";

const shortsFeedQuerySchema = shortsFeedInputSchema.extend({
  cursor: z.string().max(4096).nullish(),
});

const markSeenInputSchema = z.object({
  videoId: z.string().min(5).max(64),
  channelId: z.string().min(1).max(128),
});

export const shortsRouter = router({
  seenVideoIds: protectedProcedure.query(({ ctx }) => {
    return [...loadShortSeenVideoIds(ctx.db, ctx.userId)];
  }),
  markSeen: protectedProcedure
    .input(markSeenInputSchema)
    .mutation(({ ctx, input }) => {
      recordShortSeen(ctx.db, ctx.userId, input.videoId, input.channelId);
      clearRecommendationCachesForUser(ctx.userId);
      return { ok: true as const };
    }),
  feed: publicProcedure
    .input(shortsFeedQuerySchema)
    .query(async ({ ctx, input }) => {
      const region =
        ctx.userId != null
          ? normalizeTrendingRegionStored(
              getUserSettings(ctx.db, ctx.userId).trendingRegion,
            )
          : normalizeTrendingRegionStored(input.region);
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      const upstream = describeUpstreamAvailability(overrides);
      try {
        const requestedLimit = input.limit ?? 24;
        const result = await fetchShortsFeedForViewer(
          ctx.db,
          ctx.userId,
          {
            region,
            limit: requestedLimit,
            continuation: input.continuation ?? input.cursor ?? undefined,
            excludeVideoIds: input.excludeVideoIds,
          },
          overrides,
        );
        return {
          videos: prepareShortsFeedVideos(result.videos, requestedLimit),
          nextCursor: result.continuation ?? undefined,
          sourceUsed: result.sourceUsed,
          warning: result.warning,
          stale: result.stale,
          upstream,
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
});
