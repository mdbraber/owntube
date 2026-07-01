import { describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("searchRouter", () => {
  it("rejects empty query (Zod)", async () => {
    const { db, sqlite } = createTestDb();
    const caller = appRouter.createCaller({ db, userId: null });
    await expect(caller.search.videos({ q: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    sqlite.close();
  });
});
