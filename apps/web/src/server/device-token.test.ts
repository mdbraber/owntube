import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { users } from "@/server/db/schema";
import { createDeviceToken } from "@/server/device-token";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

const { db, sqlite } = createTestDb();

vi.mock("@/server/auth", () => ({ auth: async () => null }));
vi.mock("@/server/db/client", () => ({ getDb: () => db }));
vi.stubEnv("AUTH_SECRET", "device-token-test-secret");

const ts = Math.floor(Date.now() / 1000);

function makeUser(email: string) {
  return db
    .insert(users)
    .values({ email, passwordHash: "x", createdAt: ts, updatedAt: ts })
    .returning({ id: users.id })
    .get();
}

afterAll(() => sqlite.close());

async function contextFor(bearer: string) {
  const { createTRPCContext } = await import("@/server/trpc/context");
  return createTRPCContext({
    req: new Request("http://localhost/api/trpc/x", {
      headers: { authorization: `Bearer ${bearer}` },
    }),
  });
}

describe("device tokens", () => {
  it("sign in as their user", async () => {
    const user = makeUser("device@example.com");
    const ctx = await contextFor(await createDeviceToken(user.id));
    expect(ctx.userId).toBe(user.id);
    await expect(appRouter.createCaller(ctx).auth.me()).resolves.toMatchObject({
      id: user.id,
    });
  });

  it("for an account this server doesn't have are no session", async () => {
    // Issued elsewhere (another instance, same secret) or for a deleted user.
    const gone = makeUser("gone@example.com");
    const token = await createDeviceToken(gone.id);
    db.delete(users).where(eq(users.id, gone.id)).run();
    const ctx = await contextFor(token);
    expect(ctx.userId).toBeNull();
    await expect(
      appRouter.createCaller(ctx).history.upsertEvent({
        videoId: "dQw4w9WgXcQ",
        channelId: "UC1",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
