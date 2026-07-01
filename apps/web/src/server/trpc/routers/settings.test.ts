import { describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("settingsRouter", () => {
  it("updates and reads user settings", async () => {
    const { db, sqlite } = createTestDb();
    const ts = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "settings@example.com",
        passwordHash: "x",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: users.id })
      .get();

    const caller = appRouter.createCaller({ db, userId: user.id });
    const initial = await caller.settings.get();
    expect(initial.visualTheme).toBe("default");

    const updated = await caller.settings.update({
      theme: "dark",
      visualTheme: "terminal",
      invidiousBaseUrl: "https://inv.example/",
    });
    expect(updated.theme).toBe("dark");
    expect(updated.visualTheme).toBe("terminal");
    expect(updated.invidiousBaseUrl).toBe("https://inv.example");
    expect(updated.invidiousBaseUrls).toEqual(["https://inv.example"]);

    const fetched = await caller.settings.get();
    expect(fetched.theme).toBe("dark");
    expect(fetched.visualTheme).toBe("terminal");
    expect(fetched.invidiousBaseUrl).toBe("https://inv.example");
    expect(fetched.invidiousBaseUrls).toEqual(["https://inv.example"]);
    expect(fetched.instanceSources.invidious.profileOverride).toBe(
      "https://inv.example",
    );
    expect(fetched.instanceSources.invidious.effectiveUrl).toBe(
      "https://inv.example",
    );
    expect(fetched.instanceSources.invidious.urls).toEqual([
      "https://inv.example",
    ]);

    const cleared = await caller.settings.clearCaches();
    expect(cleared.ok).toBe(true);
    expect(typeof cleared.clearedRows).toBe("number");

    sqlite.close();
  });

  it("stores multiple source instances and validates preferred URLs", async () => {
    const { db, sqlite } = createTestDb();
    const ts = Math.floor(Date.now() / 1000);
    const user = db
      .insert(users)
      .values({
        email: "instances@example.com",
        passwordHash: "x",
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: users.id })
      .get();

    const caller = appRouter.createCaller({ db, userId: user.id });
    const updated = await caller.settings.update({
      pipedBaseUrls: [
        "https://one.example/",
        "https://one.example",
        "https://two.example",
      ],
      preferredPipedBaseUrl: "https://two.example",
    });

    expect(updated.pipedBaseUrls).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
    expect(updated.preferredPipedBaseUrl).toBe("https://two.example");
    expect(updated.pipedBaseUrl).toBe("https://one.example");

    sqlite.close();
  });
});
