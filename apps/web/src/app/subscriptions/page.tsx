import { HydrationBoundary } from "@tanstack/react-query";
import { createServerSideHelpers } from "@trpc/react-query/server";
import { redirect } from "next/navigation";
import superjson from "superjson";
import { PageHeader } from "@/components/layout/page-header";
import { SubscriptionsTabs } from "@/components/subscriptions/subscriptions-tabs";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/trpc/caller";
import { createTRPCContext } from "@/server/trpc/context";
import { appRouter } from "@/server/trpc/root";

export default async function SubscriptionsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/subscriptions");
  }
  const caller = await createCaller();
  const list = await caller.subscriptions.list();
  const channels = await caller.subscriptions.listDetailed();

  // Prefetch the unfiltered first page so the feed paints from cache instead of
  // a skeleton. cache-only keeps SSR from ever blocking on the upstream feed;
  // the client (refetchOnMount: "always") revalidates. The input MUST match the
  // client's first query exactly (limit 24, refreshToken 0, no tag filter) or
  // the hydrated data won't match the query key. A saved tag filter changes the
  // key client-side and falls back to a normal fetch (still instant on repeat
  // visits via the IndexedDB query cache).
  const helpers = createServerSideHelpers({
    router: appRouter,
    ctx: { ...(await createTRPCContext()), prefetchCacheOnly: true },
    transformer: superjson,
  });
  if (list.length > 0) {
    await helpers.subscriptions.mergedFeedInfinite
      .prefetchInfinite({
        limit: 24,
        refreshToken: 0,
        includeTags: undefined,
        excludeTags: undefined,
      })
      .catch(() => {
        // Cold cache / upstream hiccup — the client fetches on mount.
      });
  }

  return (
    <main className="ot-page space-y-8">
      <PageHeader
        title="Subscriptions"
        subtitle="Uploads and channels you follow."
      />

      {list.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          You are not subscribed to any channel yet. Open a channel page and
          press Subscribe, or paste a channel ID you know.
        </p>
      ) : (
        <HydrationBoundary state={helpers.dehydrate()}>
          <SubscriptionsTabs channels={channels} />
        </HydrationBoundary>
      )}
    </main>
  );
}
