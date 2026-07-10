import { z } from "zod";
import { sponsorBlockCategorySchema } from "@/lib/sponsorblock";
import { getSponsorBlockSegments } from "@/server/sponsorblock/service";
import { publicProcedure, router } from "@/server/trpc/init";

const segmentsInputSchema = z.object({
  videoId: z.string().min(1).max(32),
  categories: z.array(sponsorBlockCategorySchema).min(1),
  durationSeconds: z.number().finite().positive().optional(),
});

export const sponsorblockRouter = router({
  segments: publicProcedure
    .input(segmentsInputSchema)
    .query(async ({ ctx, input }) =>
      // SQLite-cached (serve-stale-and-revalidate, warmed for likely-next
      // videos); see @/server/sponsorblock/service.
      getSponsorBlockSegments(ctx.db, input),
    ),
});
