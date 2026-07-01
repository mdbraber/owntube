export default function HistoryLoading() {
  const skeletonIds = [
    "history-skeleton-1",
    "history-skeleton-2",
    "history-skeleton-3",
    "history-skeleton-4",
    "history-skeleton-5",
    "history-skeleton-6",
    "history-skeleton-7",
    "history-skeleton-8",
  ];
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl space-y-3 px-4 py-8">
      {skeletonIds.map((id) => (
        <div
          key={id}
          className="h-16 animate-pulse rounded-lg bg-[hsl(var(--muted))]"
        />
      ))}
    </main>
  );
}
