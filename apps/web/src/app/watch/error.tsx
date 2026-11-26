"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function WatchError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">Could not load this video</h1>
      <p className="font-mono text-sm text-[hsl(var(--muted-foreground))]">
        {error.message}
      </p>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        YouTube may be refusing OwnTube for a moment. Try again shortly.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => reset()}>Retry</Button>
        <Button variant="outline" asChild>
          <Link href="/search">Back to search</Link>
        </Button>
      </div>
    </main>
  );
}
