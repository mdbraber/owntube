import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { parseLibraryQuery } from "@/lib/library-query";
import { fetchSearchSuggestions, searchVideos } from "@/server/catalog";
import { searchVideosInputSchema } from "@/server/catalog/types";
import { channelTags, playlists } from "@/server/db/schema";
import { RateLimitExceededError } from "@/server/errors/rate-limit-exceeded";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { searchLibrary } from "@/server/search/library-search";
import { getUserSettings } from "@/server/settings/profile";
import {
  protectedProcedure,
  publicProcedure,
  router,
} from "@/server/trpc/init";

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

  /**
   * Search the user's own library with filters (`has:memo`, `tag:music`,
   * `in:favorites -in:history`, …; see lib/library-query.ts). A query
   * without filters is refused: that is a YouTube search (search.videos).
   */
  library: protectedProcedure
    .input(
      z.object({
        q: z.string().trim().min(1).max(500),
        page: z.number().int().min(1).max(1000).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { favoriteTag } = getUserSettings(ctx.db, ctx.userId);
      const parsed = parseLibraryQuery(input.q, { favoriteTag });
      if (parsed.kind === "plain") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Library search needs a filter such as has:memo, tag:music or in:saved.",
        });
      }
      if (parsed.kind === "error") {
        throw new TRPCError({ code: "BAD_REQUEST", message: parsed.message });
      }
      const result = await searchLibrary(ctx.db, ctx.userId, parsed, {
        page: input.page,
      });
      return { ...result, filters: parsed.filters, words: parsed.words };
    }),

  /** What the filter suggestions offer: the user's tags and playlists. */
  libraryVocabulary: protectedProcedure.query(({ ctx }) => {
    const { favoriteTag } = getUserSettings(ctx.db, ctx.userId);
    const tags = ctx.db
      .select({
        tag: channelTags.tag,
        count: sql<number>`count(distinct ${channelTags.channelId})`,
      })
      .from(channelTags)
      .where(eq(channelTags.userId, ctx.userId))
      .groupBy(channelTags.tag)
      .orderBy(asc(channelTags.tag))
      .all()
      .map((r) => ({ tag: r.tag, count: Number(r.count) }));
    const lists = ctx.db
      .select({ id: playlists.id, name: playlists.name })
      .from(playlists)
      .where(eq(playlists.userId, ctx.userId))
      .orderBy(asc(playlists.name))
      .all();
    return { favoriteTag, tags, playlists: lists };
  }),
});
