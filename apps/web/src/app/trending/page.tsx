import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { VideoGrid } from "@/components/videos/video-grid";
import { trendingInputSchema } from "@/server/services/proxy.types";
import { createCaller } from "@/server/trpc/caller";

type TrendingPageProps = {
  searchParams: Promise<{ region?: string | string[] }>;
};

async function TrendingGrid({ region }: { region: string }) {
  const input = trendingInputSchema.parse({
    region: region.length === 2 ? region : "US",
    limit: 48,
  });
  const caller = await createCaller();
  const data = await caller.trending.list(input);
  return (
    <section className="space-y-4">
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Source: {data.sourceUsed}
        {data.stale ? " · stale cache" : ""}
      </p>
      <VideoGrid videos={data.videos} />
    </section>
  );
}

export default async function TrendingPage({
  searchParams,
}: TrendingPageProps) {
  const sp = await searchParams;
  const raw = sp.region;
  const region =
    typeof raw === "string" && raw.length === 2 ? raw.toUpperCase() : "US";

  return (
    <main className="ot-page space-y-6">
      <PageHeader
        title="Explore"
        subtitle={
          <>
            Trending for region{" "}
            <span className="font-mono text-[hsl(var(--foreground))]">
              {region}
            </span>{" "}
            — use{" "}
            <code className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono text-xs">
              ?region=FR
            </code>
            .
          </>
        }
      />
      <Suspense
        fallback={
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Loading…
          </p>
        }
      >
        <TrendingGrid region={region} />
      </Suspense>
    </main>
  );
}
