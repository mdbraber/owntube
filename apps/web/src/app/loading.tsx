const CARD_IDS = [
  "sk-1",
  "sk-2",
  "sk-3",
  "sk-4",
  "sk-5",
  "sk-6",
  "sk-7",
  "sk-8",
];

export default function RootLoading() {
  return (
    <main className="ot-page">
      <div className="mb-6 h-7 w-48 animate-pulse rounded-lg bg-[hsl(var(--muted))]" />
      <div className="ot-video-grid ot-video-grid--large mx-[-16px] w-[calc(100%_+_2rem)] sm:mx-0 sm:w-full">
        {CARD_IDS.map((id) => (
          <div key={id} className="space-y-3">
            <div className="aspect-video w-full animate-pulse rounded-none bg-[hsl(var(--muted))] sm:rounded-xl" />
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
    </main>
  );
}
