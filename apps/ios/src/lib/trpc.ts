import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@web/server/trpc/root";
import superjson from "superjson";
import { SERVER_URL } from "@/lib/config";
import { getToken } from "@/lib/session";

/**
 * The web app's API, for what the native side does itself (playback, watch
 * progress). Signed in with the app's device token when it has one; the
 * WebViews use the web sign-in cookie instead.
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${SERVER_URL}/api/trpc`,
      transformer: superjson,
      headers: async () => {
        const token = await getToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
