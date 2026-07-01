import { TRPCError } from "@trpc/server";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { searchVideos } from "@/server/services/proxy";
import { searchVideosInputSchema } from "@/server/services/proxy.types";
import {
  fetchSearchQuerySuggestions,
  searchSuggestionsInputSchema,
} from "@/server/services/search-suggestions";
import { getUserProxyOverrides } from "@/server/settings/profile";
import { publicProcedure, router } from "@/server/trpc/init";

export const searchRouter = router({
  suggestions: publicProcedure
    .input(searchSuggestionsInputSchema)
    .query(async ({ ctx, input }) => {
      const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
      return fetchSearchQuerySuggestions(input, overrides);
    }),
  videos: publicProcedure
    .input(searchVideosInputSchema)
    .query(async ({ ctx, input }) => {
      try {
        const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
        return await searchVideos(ctx.db, input, overrides);
      } catch (e) {
        if (e instanceof UpstreamUnavailableError) {
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: e.message,
          });
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
