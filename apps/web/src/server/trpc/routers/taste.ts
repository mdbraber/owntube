import { z } from "zod";
import { clearRecommendationCachesForUser } from "@/server/recommendation/engine";
import { buildTasteDeckVideos } from "@/server/recommendation/taste-deck-pool";
import {
  getUserProxyOverrides,
  getUserSettings,
  normalizeTrendingRegionStored,
  upsertUserSettings,
} from "@/server/settings/profile";
import { protectedProcedure, router } from "@/server/trpc/init";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

const saveKeywordsSchema = z.object({
  keywords: z.array(z.string()).max(30),
});

export const tasteRouter = router({
  deck: protectedProcedure.query(async ({ ctx }) => {
    const settings = getUserSettings(ctx.db, ctx.userId);
    const region = normalizeTrendingRegionStored(settings.trendingRegion);
    const overrides = getUserProxyOverrides(ctx.db, ctx.userId);
    return buildTasteDeckVideos(ctx.db, ctx.userId, { region, overrides });
  }),

  saveKeywords: protectedProcedure
    .input(saveKeywordsSchema)
    .mutation(({ ctx, input }) => {
      const keywords = input.keywords
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      upsertUserSettings(ctx.db, ctx.userId, { tasteKeywords: keywords });
      clearRecommendationCachesForUser(ctx.userId);
      return { ok: true as const };
    }),

  complete: protectedProcedure.mutation(({ ctx }) => {
    const ts = nowUnix();
    upsertUserSettings(ctx.db, ctx.userId, {
      tasteOnboardingCompletedAt: ts,
      tasteOnboardingSkippedAt: undefined,
    });
    clearRecommendationCachesForUser(ctx.userId);
    return { ok: true as const };
  }),

  skip: protectedProcedure.mutation(({ ctx }) => {
    const ts = nowUnix();
    upsertUserSettings(ctx.db, ctx.userId, {
      tasteOnboardingSkippedAt: ts,
      tasteOnboardingCompletedAt: undefined,
    });
    clearRecommendationCachesForUser(ctx.userId);
    return { ok: true as const };
  }),
});
