import { createTRPCContext } from "@/server/trpc/context";
import { appRouter } from "@/server/trpc/root";

/**
 * `req` lets route handlers authenticate native clients, which have no session
 * cookie and send a device-token Bearer header instead (see createTRPCContext).
 */
export async function createCaller(req?: Request) {
  const ctx = await createTRPCContext(req ? { req } : undefined);
  return appRouter.createCaller(ctx);
}
