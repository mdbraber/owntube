import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  clearLoginFailures,
  isLoginThrottled,
  recordLoginFailure,
} from "@/server/login-throttle";

// Shared by the web Credentials provider (auth.ts) and the TV `auth.deviceLogin`
// procedure so both paths verify passwords identically. Lives outside auth.ts to
// keep NextAuth (and its `next/server` import) off the tRPC router/test path.
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ id: number; email: string } | null> {
  const normalizedEmail = email.trim().toLowerCase();
  // Brute-force guard: after too many failures the email is rejected before
  // bcrypt runs, indistinguishably from a wrong password.
  if (isLoginThrottled(normalizedEmail)) return null;
  const db = getDb();
  const user = db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1)
    .all()[0];
  if (!user) {
    recordLoginFailure(normalizedEmail);
    return null;
  }
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    recordLoginFailure(normalizedEmail);
    return null;
  }
  clearLoginFailures(normalizedEmail);
  return { id: user.id, email: user.email };
}
