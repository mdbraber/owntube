import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { apiTokens } from "@/server/db/schema";

// Revocable, scoped Bearer tokens for services (the n8n playback mesh), as
// opposed to device tokens: those are 30-day JWTs carrying full account access
// that can only be revoked by rotating AUTH_SECRET. An API token is a random
// string whose SHA-256 is looked up per request, so revoking is one row update.

/** Prefix that tells the Bearer path an API token from a device-token JWT. */
export const API_TOKEN_PREFIX = "ot_";

/**
 * What a token may call: each scope grants a fixed list of tRPC procedure
 * paths, on top of public procedures (which need no token at all). Anything
 * not listed is refused, so a new procedure is never reachable by accident.
 */
export const API_TOKEN_SCOPES = {
  playback: {
    label: "Playback sync",
    description:
      "Record watch progress and remove archived videos from the queue, saved or a playlist — what the Pocket Casts playback mesh needs.",
    procedures: ["history.upsertEvent", "remote.archiveFromFeed"],
  },
  memos: {
    label: "Add memos",
    description:
      "Add memos to videos and add those videos to a playlist — what the Slack workflow needs.",
    procedures: ["memos.add"],
  },
} as const satisfies Record<
  string,
  { label: string; description: string; procedures: readonly string[] }
>;

export type ApiTokenScope = keyof typeof API_TOKEN_SCOPES;

export const API_TOKEN_SCOPE_KEYS = Object.keys(
  API_TOKEN_SCOPES,
) as ApiTokenScope[];

export type ResolvedApiToken = {
  id: number;
  userId: number;
  scopes: ApiTokenScope[];
};

// last_used_at is informational; don't write it on every request.
const LAST_USED_RESOLUTION_SEC = 60;

export function generateApiToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isApiToken(bearer: string): boolean {
  return bearer.startsWith(API_TOKEN_PREFIX);
}

export function parseScopes(json: string): ApiTokenScope[] {
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter((s): s is ApiTokenScope =>
      API_TOKEN_SCOPE_KEYS.includes(s as ApiTokenScope),
    );
  } catch {
    return [];
  }
}

/** The live token for this Bearer value, or null (unknown or revoked). */
export function resolveApiToken(
  db: AppDb,
  token: string,
  now: number = Math.floor(Date.now() / 1000),
): ResolvedApiToken | null {
  const row = db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashApiToken(token)))
    .get();
  if (!row || row.revokedAt !== null) return null;
  if (
    row.lastUsedAt === null ||
    now - row.lastUsedAt >= LAST_USED_RESOLUTION_SEC
  ) {
    db.update(apiTokens)
      .set({ lastUsedAt: now })
      .where(eq(apiTokens.id, row.id))
      .run();
  }
  return { id: row.id, userId: row.userId, scopes: parseScopes(row.scopes) };
}

export function apiTokenAllows(
  scopes: readonly ApiTokenScope[],
  path: string,
): boolean {
  return scopes.some((scope) =>
    (API_TOKEN_SCOPES[scope].procedures as readonly string[]).includes(path),
  );
}
