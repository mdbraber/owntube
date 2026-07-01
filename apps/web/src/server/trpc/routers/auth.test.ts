import { describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("authRouter", () => {
  it("creates a user with register mutation", async () => {
    const { db, sqlite } = createTestDb();
    const caller = appRouter.createCaller({ db, userId: null });
    const user = await caller.auth.register({
      email: "test@example.com",
      password: "password123",
    });
    expect(user.email).toBe("test@example.com");
    sqlite.close();
  });
});
