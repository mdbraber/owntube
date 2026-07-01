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
  const isPipedDown =
    error.message.includes("502") || error.message.includes("503");
  const isInvidiousBlocked = error.message.includes("403");

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">Could not load this video</h1>
      <p className="font-mono text-sm text-[hsl(var(--muted-foreground))]">
        {error.message}
      </p>
      {isPipedDown && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950">
          <p className="font-medium text-amber-800 dark:text-amber-200">
            Piped instance unreachable
          </p>
          <p className="mt-1 text-amber-700 dark:text-amber-300">
            Video playback requires a working Piped instance.{" "}
            <strong>
              Change <code>PIPED_BASE_URL</code> in your <code>.env</code>
            </strong>{" "}
            to a different instance from{" "}
            <a
              href="https://piped-instances.kavin.rocks/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              piped-instances.kavin.rocks
            </a>
            , then restart <code>pnpm dev</code>.
          </p>
        </div>
      )}
      {!isPipedDown && isInvidiousBlocked && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950">
          <p className="font-medium text-amber-800 dark:text-amber-200">
            Invidious instance blocked video detail
          </p>
          <p className="mt-1 text-amber-700 dark:text-amber-300">
            Your Invidious instance returned 403 on the video endpoint. Try a
            different instance or set a working <code>PIPED_BASE_URL</code>.
          </p>
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={() => reset()}>Retry</Button>
        <Button variant="outline" asChild>
          <Link href="/search">Back to search</Link>
        </Button>
      </div>
    </main>
  );
}
