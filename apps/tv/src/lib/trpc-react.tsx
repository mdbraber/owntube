import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@web/server/trpc/root";
import type { ReactNode } from "react";
import { useState } from "react";
import superjson from "superjson";
import { getToken } from "@/lib/auth-token";
import { TRPC_URL } from "@/lib/config";
import { CACHE_BUSTER, persister, queryClient } from "@/lib/query-client";

/**
 * Mirrors apps/web/src/trpc/react.tsx so both clients use the same hooks API —
 * `trpc.<router>.<procedure>.useQuery()` means the same thing on either surface.
 */
export const trpc = createTRPCReact<AppRouter>();

export function TrpcProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: TRPC_URL,
          transformer: superjson,
          // Read per request so a fresh login or logout takes effect without
          // rebuilding the client.
          headers: async () => {
            const token = await getToken();
            return token ? { authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      {/* Restores the last snapshot before children render, so a revisited
          screen paints immediately instead of showing a spinner. A snapshot
          that is corrupt, older than maxAge, or from a different buster is
          discarded rather than trusted. */}
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 24 * 60 * 60 * 1000,
          buster: CACHE_BUSTER,
          dehydrateOptions: {
            // Never persist loading or errored queries — only settled data.
            shouldDehydrateQuery: (query) => query.state.status === "success",
          },
        }}
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </PersistQueryClientProvider>
    </trpc.Provider>
  );
}
