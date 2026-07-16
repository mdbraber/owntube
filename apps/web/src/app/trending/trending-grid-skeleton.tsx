const CARD_IDS = [
  "tr-1",
  "tr-2",
  "tr-3",
  "tr-4",
  "tr-5",
  "tr-6",
  "tr-7",
  "tr-8",
];

/**
 * Placeholder for the Explore grid: the same edge-to-edge / square-thumbnail
 * card shape the loaded trending videos use, so the loading state is a
 * backdrop of what's about to appear rather than bare text.
 */
export function TrendingGridSkeleton() {
  return (
    <div
      className="ot-video-grid mx-[-16px] w-[calc(100%_+_2rem)] sm:mx-0 sm:w-full"
      aria-hidden
    >
      {CARD_IDS.map((id) => (
        <div key={id} className="space-y-3">
          <div className="aspect-video w-full animate-pulse rounded-none bg-[hsl(var(--muted))] sm:rounded-[var(--radius-card)]" />
          <div className="flex gap-3 px-4 sm:px-0">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[hsl(var(--muted))]" />
            <div className="min-w-0 flex-1 space-y-2 py-0.5">
              <div className="h-3.5 w-[85%] animate-pulse rounded bg-[hsl(var(--muted))]" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-[hsl(var(--muted))]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
