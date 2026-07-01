"use client";

export default function HistoryError({ error }: { error: Error }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Could not load history</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        {error.message}
      </p>
    </main>
  );
}
