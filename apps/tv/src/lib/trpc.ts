import { createTRPCClient, httpBatchLink } from "@trpc/client";
// Type-only import: erased at build time, so Metro never bundles any server
// code. It gives the TV client the same end-to-end type safety as the web app.
import type { AppRouter } from "@web/server/trpc/root";
import superjson from "superjson";
import { getToken } from "@/lib/auth-token";
import { TRPC_URL } from "@/lib/config";

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: TRPC_URL,
      transformer: superjson,
      // Read on every request so a fresh login (or logout) takes effect without
      // rebuilding the client. The server falls back to this Bearer token when
      // there is no Auth.js cookie (createTRPCContext).
      headers: async () => {
        const token = await getToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
