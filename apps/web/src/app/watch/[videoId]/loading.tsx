export default function WatchLoading() {
  const relatedSkeletonIds = [
    "watch-related-1",
    "watch-related-2",
    "watch-related-3",
    "watch-related-4",
    "watch-related-5",
    "watch-related-6",
  ];
  return (
    <main className="mx-auto grid min-h-screen max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <div className="aspect-video animate-pulse rounded-xl bg-[hsl(var(--muted))]" />
        <div className="h-7 w-2/3 animate-pulse rounded bg-[hsl(var(--muted))]" />
        <div className="h-5 w-1/3 animate-pulse rounded bg-[hsl(var(--muted))]" />
      </div>
      <div className="space-y-3">
        {relatedSkeletonIds.map((id) => (
          <div
            key={id}
            className="flex gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-md shadow-black/[0.04] dark:shadow-black/30"
          >
            <div className="aspect-video w-[7.25rem] shrink-0 animate-pulse rounded-lg bg-[hsl(var(--muted))] sm:w-32" />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 py-1">
              <div className="h-3.5 w-full animate-pulse rounded bg-[hsl(var(--muted))]" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-[hsl(var(--muted))]" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
