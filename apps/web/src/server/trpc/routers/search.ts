import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fetchSearchSuggestions, searchVideos } from "@/server/catalog";
import { searchVideosInputSchema } from "@/server/catalog/types";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { publicProcedure, router } from "@/server/trpc/init";

export const searchRouter = router({
  suggestions: publicProcedure
    .input(z.object({ q: z.string().max(200) }))
    .query(async ({ input }) => ({
      // Suggestions are a nicety: a failure shows none.
      suggestions: await fetchSearchSuggestions(input.q).catch(() => []),
    })),
  videos: publicProcedure
    .input(searchVideosInputSchema)
    .query(async ({ input }) => {
      try {
        return await searchVideos(input);
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
