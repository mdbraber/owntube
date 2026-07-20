import { createServerSideHelpers } from "@trpc/react-query/server";
import { HydrationBoundary } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import superjson from "superjson";
import { HomeBlocksClient } from "@/components/home/home-blocks-client";
import {
  blockFetchCount,
  blockTagLists,
  DEFAULT_HOME_BLOCKS,
  type HomeBlock,
  homeBlockOption,
} from "@/lib/home-blocks";
import { auth } from "@/server/auth";
import {
  getUserSettings,
  normalizeTrendingRegionStored,
} from "@/server/settings/profile";
import { createTRPCContext } from "@/server/trpc/context";
import { appRouter } from "@/server/trpc/root";

type Helpers = ReturnType<typeof createServerSideHelpers<typeof appRouter>>;

/**
 * Prefetch a block's first page with the *exact* input its client query uses
 * (shared derivation helpers keep the keys in sync), so react-query hydrates it
 * and the block paints without a skeleton. Every home query is either a DB read
 * or already cache-only, so these never block SSR on upstream. Unknown types
 * fall through — the client just fetches them as before (no regression).
 */
function prefetchBlock(
  helpers: Helpers,
  block: HomeBlock,
  region: string,
): Promise<unknown> {
  switch (block.type) {
    case "subscriptions": {
      const { includeTags, excludeTags } = blockTagLists(block);
      return helpers.subscriptions.mergedFeedInfinite.prefetchInfinite({
        limit: Math.min(48, Math.max(8, blockFetchCount(block) * 2)),
        includeTags,
        excludeTags,
        hideShorts: homeBlockOption(block, "hideShorts"),
        hideIgnored: homeBlockOption(block, "hideIgnored"),
      });
    }
    case "queue":
      return helpers.queue.listDetailed.prefetch();
    case "history":
      return helpers.history.list.prefetch({
        page: 1,
        pageSize: Math.min(24, blockFetchCount(block)),
        hideWatched: homeBlockOption(block, "hideCompleted"),
      });
    case "recommended":
      return helpers.feed.home.prefetchInfinite({
        region,
        pageSize: Math.min(48, Math.max(12, blockFetchCount(block))),
      });
    case "explore":
      return helpers.trending.list.prefetch({ region, limit: 60 });
    default:
      return Promise.resolve();
  }
}

export default async function HomePage() {
  const session = await auth();
  // The modular home is built from personal library sections — signed-out
  // visitors land on the recommendation feed instead.
  if (!session?.user?.id) {
    redirect("/recommended");
  }

  // cache-only: the SSR prefetch must never block on the reco engine/upstream;
  // a cold home-feed miss just falls back to the client fetch.
  const ctx = { ...(await createTRPCContext()), prefetchCacheOnly: true };
  const helpers = createServerSideHelpers({
    router: appRouter,
    ctx,
    transformer: superjson,
  });

  // Resolve the block config + region server-side so the first client render
  // (and the queries it fires) match the prefetched/hydrated data.
  const settings =
    ctx.userId != null ? getUserSettings(ctx.db, ctx.userId) : null;
  const blocks: HomeBlock[] = settings?.homeBlocks ?? DEFAULT_HOME_BLOCKS;
  const region = normalizeTrendingRegionStored(settings?.trendingRegion ?? "US");

  await Promise.allSettled([
    helpers.settings.get.prefetch(),
    ...blocks.map((b) => prefetchBlock(helpers, b, region)),
  ]);

  return (
    <main className="ot-page">
      <HydrationBoundary state={helpers.dehydrate()}>
        <HomeBlocksClient initialBlocks={blocks} />
      </HydrationBoundary>
    </main>
  );
}
