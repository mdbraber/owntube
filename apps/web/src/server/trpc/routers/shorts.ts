import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prepareShortsFeedVideos } from "@/lib/shorts-feed-presentation";
import { ensureAnonViewerId } from "@/server/anon-viewer";
import { shortsFeedInputSchema } from "@/server/catalog/types";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { clearRecommendationCachesForUser } from "@/server/recommendation/engine";
import { fetchShortsFeedForViewer } from "@/server/recommendation/shorts-feed";
import {
  recordAnonShortSeen,
  recordShortSeen,
} from "@/server/recommendation/shorts-seen";
import {
  getUserSettings,
  normalizeTrendingRegionStored,
} from "@/server/settings/profile";
import { publicProcedure, router } from "@/server/trpc/init";

// No client-supplied exclusion list: the server owns what each viewer has seen
// (user id or anonymous cookie), so the request stays a constant size however
// long someone scrolls.
const shortsFeedQuerySchema = shortsFeedInputSchema
  .omit({ excludeVideoIds: true })
  .extend({
    cursor: z.string().max(4096).nullish(),
  });

const markSeenInputSchema = z.object({
  videoId: z.string().min(5).max(64),
  channelId: z.string().min(1).max(128),
});

export const shortsRouter = router({
  markSeen: publicProcedure
    .input(markSeenInputSchema)
    .mutation(({ ctx, input }) => {
      if (ctx.userId != null) {
        recordShortSeen(ctx.db, ctx.userId, input.videoId, input.channelId);
        clearRecommendationCachesForUser(ctx.userId);
        return { ok: true as const };
      }
      const anonId = ctx.anon ? ensureAnonViewerId(ctx.anon) : null;
      if (anonId) recordAnonShortSeen(ctx.db, anonId, input.videoId);
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
      try {
        const requestedLimit = input.limit ?? 24;
        const result = await fetchShortsFeedForViewer(
          ctx.db,
          ctx.userId,
          {
            region,
            limit: requestedLimit,
            continuation: input.continuation ?? input.cursor ?? undefined,
            purpose: input.purpose,
          },
          ctx.userId == null ? (ctx.anon?.id ?? null) : null,
        );
        return {
          videos: prepareShortsFeedVideos(result.videos, requestedLimit),
          nextCursor: result.continuation ?? undefined,
          warning: result.warning,
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
