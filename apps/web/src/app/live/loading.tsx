import { LiveGridSkeleton } from "@/app/live/live-grid-skeleton";

export default function LiveLoading() {
  return (
    <main className="ot-page space-y-6">
      <div className="mb-6 space-y-2">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-[hsl(var(--muted))]" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-[hsl(var(--muted)_/_0.6)]" />
      </div>
      <LiveGridSkeleton />
    </main>
  );
}
