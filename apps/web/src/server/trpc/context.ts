import { auth } from "@/server/auth";
import { type AppDb, getDb } from "@/server/db/client";
import { userIdFromDeviceToken } from "@/server/device-token";

export type TRPCContext = {
  db: AppDb;
  userId: number | null;
};

export async function createTRPCContext(opts?: {
  req?: Request;
}): Promise<TRPCContext> {
  const session = await auth();
  const parsedId = session?.user?.id
    ? Number.parseInt(session.user.id, 10)
    : Number.NaN;
  let userId = Number.isFinite(parsedId) ? parsedId : null;

  // Native clients (TV) have no cookie; fall back to a device-token Bearer header.
  if (userId === null) {
    const header = opts?.req?.headers.get("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (bearer) userId = await userIdFromDeviceToken(bearer);
  }

  return { db: getDb(), userId };
}
