import { Suspense } from "react";
import { LiveGridSkeleton } from "@/app/live/live-grid-skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { VideoGrid } from "@/components/videos/video-grid";
import { createCaller } from "@/server/trpc/caller";

async function LiveGrid() {
  const caller = await createCaller();
  const data = await caller.live.list({ limit: 48 });
  return (
    <section className="space-y-4">
      <VideoGrid videos={data.videos} enableSwipe />
    </section>
  );
}

/** YouTube's Live page: what is streaming now. */
export default function LivePage() {
  return (
    <main className="ot-page space-y-6">
      <PageHeader title="Live" subtitle="Streaming on YouTube right now." />
      <Suspense fallback={<LiveGridSkeleton />}>
        <LiveGrid />
      </Suspense>
    </main>
  );
}
