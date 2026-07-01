import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { fetchChannelPage } from "@/server/services/proxy";
import { channelPageInputSchema } from "@/server/services/proxy.types";
import { getUserProxyOverrides } from "@/server/settings/profile";
import { publicProcedure, router } from "@/server/trpc/init";

const channelPageQuerySchema = channelPageInputSchema.extend({
  /** Set by `useInfiniteQuery` from `getNextPageParam` (channel continuation token). */
  cursor: z.string().max(16384).nullish(),
});

export const channelRouter = router({
  page: publicProcedure
    .input(channelPageQuerySchema)
    .query(async ({ ctx, input }) => {
      const { cursor, continuation, channelId, tab } = input;
      try {
        const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
        return await fetchChannelPage(
          ctx.db,
          {
            channelId,
            tab,
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
