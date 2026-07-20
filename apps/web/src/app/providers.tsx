"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useEffect, useState } from "react";
import superjson from "superjson";
import {
  restoreQueryCache,
  startQueryCachePersist,
} from "@/lib/query-persist";
import { PlayerProvider } from "@/components/player/player-context";
import { QueueSync } from "@/components/queue/queue-sync";
import { FaviconSync } from "@/components/settings/favicon-sync";
import { MiniPlayerSync } from "@/components/settings/mini-player-sync";
import { SponsorBlockSync } from "@/components/settings/sponsorblock-sync";
import { ThemeSync } from "@/components/settings/theme-sync";
import { ActionToastProvider } from "@/components/videos/action-toast";
import { IgnoredVideosProvider } from "@/components/videos/ignored-videos-context";
import { InvidiousOriginProvider } from "@/components/videos/invidious-origin-context";
import { VideoMembershipProvider } from "@/components/videos/video-membership-context";
import { trpc } from "@/trpc/react";

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return "";
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/**
 * True for failures worth retrying: a dropped connection (no HTTP response, so
 * no httpStatus) or a transient server error (5xx). A tRPC error that reached
 * the server with a 4xx is permanent (not found, bad input, auth) — don't retry.
 */
function isTransientNetworkError(error: unknown): boolean {
  const status = (
    error as { data?: { httpStatus?: number } } | null | undefined
  )?.data?.httpStatus;
  if (status === undefined || status === 0) return true;
  return status >= 500;
}

export function Providers({
  children,
  invidiousOrigins = [],
}: {
  children: React.ReactNode;
  /** Server-computed Invidious origins (from INVIDIOUS_BASE_URL) for browser image URLs. */
  invidiousOrigins?: readonly string[];
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            // Retry transient connection drops (Safari recycling an idle HTTP/2
            // connection → "network connection was lost"). Only network-level
            // failures — a tRPC error from the server carries an httpStatus and
            // shouldn't be retried blindly.
            retry: (failureCount, error) =>
              isTransientNetworkError(error) && failureCount < 3,
          },
          mutations: {
            // Mutations don't retry by default, so a dropped connection surfaces
            // (e.g. the ~20s history.upsertEvent ping). Our mutations are
            // idempotent (upsert/set/conflict-safe), so retrying a lost
            // connection is safe and makes the error vanish.
            retry: (failureCount, error) =>
              isTransientNetworkError(error) && failureCount < 2,
            retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 3000),
          },
        },
      }),
  );
  // Restore the last IndexedDB snapshot, then persist future cache changes.
  // Persisting starts only after restore so we don't overwrite the snapshot
  // with an empty cache before reading it.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    void restoreQueryCache(queryClient).finally(() => {
      if (cancelled) return;
      stop = startQueryCachePersist(queryClient);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [queryClient]);

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeSync />
        <FaviconSync />
        <MiniPlayerSync />
        <SponsorBlockSync />
        <QueueSync />
        <InvidiousOriginProvider origins={invidiousOrigins}>
          <ActionToastProvider>
            <IgnoredVideosProvider>
              <VideoMembershipProvider>
                <PlayerProvider>{children}</PlayerProvider>
              </VideoMembershipProvider>
            </IgnoredVideosProvider>
          </ActionToastProvider>
        </InvidiousOriginProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
