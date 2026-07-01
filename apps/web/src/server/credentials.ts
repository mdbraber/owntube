import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

// Shared by the web Credentials provider (auth.ts) and the TV `auth.deviceLogin`
// procedure so both paths verify passwords identically. Lives outside auth.ts to
// keep NextAuth (and its `next/server` import) off the tRPC router/test path.
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ id: number; email: string } | null> {
  const db = getDb();
  const user = db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1)
    .all()[0];
  if (!user) return null;
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) return null;
  return { id: user.id, email: user.email };
}
