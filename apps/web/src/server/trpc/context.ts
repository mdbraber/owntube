import { eq } from "drizzle-orm";
import { type AnonViewer, createAnonViewer } from "@/server/anon-viewer";
import {
  isApiToken,
  type ResolvedApiToken,
  resolveApiToken,
} from "@/server/api-token";
import { auth } from "@/server/auth";
import { type AppDb, getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { userIdFromDeviceToken } from "@/server/device-token";

export type TRPCContext = {
  db: AppDb;
  userId: number | null;
  /**
   * Set on the SSR-prefetch caller (home page). Procedures that would otherwise
   * compute/hit upstream (e.g. the personalized home feed) serve cache-only so
   * server render never blocks; a cold miss falls back to the client fetch.
   */
  prefetchCacheOnly?: boolean;
  /** Signed-out viewer identity (cookie); unused when `userId` is set. */
  anon?: AnonViewer;
  /** Set when the request authenticated with an API token: protected
   * procedures are then limited to its scopes (see protectedProcedure). */
  apiToken?: ResolvedApiToken;
};

export async function createTRPCContext(opts?: {
  req?: Request;
  resHeaders?: Headers;
}): Promise<TRPCContext> {
  const session = await auth();
  const parsedId = session?.user?.id
    ? Number.parseInt(session.user.id, 10)
    : Number.NaN;
  let userId = Number.isFinite(parsedId) ? parsedId : null;
  const db = getDb();
  let apiToken: ResolvedApiToken | undefined;

  // No cookie: native clients (TV) send a device-token Bearer header, services
  // a scoped API token.
  if (userId === null) {
    const header = opts?.req?.headers.get("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (bearer && isApiToken(bearer)) {
      apiToken = resolveApiToken(db, bearer) ?? undefined;
      userId = apiToken?.userId ?? null;
    } else if (bearer) {
      const id = await userIdFromDeviceToken(bearer);
      // A device token can decode fine and still name no account here: one
      // issued by another instance that shares AUTH_SECRET, or for a deleted
      // user. Treat it as no token, so every protected procedure answers
      // UNAUTHORIZED (the TV's cue to sign in again) rather than running as a
      // user that doesn't exist.
      userId = id !== null && userExists(db, id) ? id : null;
    }
  }

  return {
    db,
    userId,
    anon: createAnonViewer(opts?.req, opts?.resHeaders),
    ...(apiToken ? { apiToken } : {}),
  };
}

function userExists(db: AppDb, id: number): boolean {
  return (
    db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .all().length > 0
  );
}
