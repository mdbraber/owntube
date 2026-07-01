"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import superjson from "superjson";
import { FaviconSync } from "@/components/settings/favicon-sync";
import { MiniPlayerSync } from "@/components/settings/mini-player-sync";
import { SponsorBlockSync } from "@/components/settings/sponsorblock-sync";
import { ThemeSync } from "@/components/settings/theme-sync";
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

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
          },
        },
      }),
  );
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
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
