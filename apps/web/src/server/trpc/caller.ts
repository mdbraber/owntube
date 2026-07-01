import { createTRPCContext } from "@/server/trpc/context";
import { appRouter } from "@/server/trpc/root";

export async function createCaller() {
  const ctx = await createTRPCContext();
  return appRouter.createCaller(ctx);
}
