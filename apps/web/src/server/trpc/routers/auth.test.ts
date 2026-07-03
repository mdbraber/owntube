import { beforeEach, describe, expect, it } from "vitest";
import { resetDevicePairingSessionsForTests } from "@/server/device-pairing";
import { appRouter } from "@/server/trpc/root";
import { createTestDb } from "@/test/db";

describe("authRouter", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-for-device-pairing-auth-router";
    resetDevicePairingSessionsForTests();
  });

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

  it("pairs a TV device after approval from an authenticated browser", async () => {
    const { db, sqlite } = createTestDb();
    const tvCaller = appRouter.createCaller({ db, userId: null });
    const browserCaller = appRouter.createCaller({ db, userId: 42 });

    const pairing = await tvCaller.auth.startDevicePairing();
    expect(pairing.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(pairing.verificationPath).toBe(`/tv/pair?code=${pairing.userCode}`);

    await expect(
      tvCaller.auth.pollDevicePairing({
        userCode: pairing.userCode,
        deviceCode: pairing.deviceCode,
      }),
    ).resolves.toMatchObject({ status: "pending" });

    await expect(
      browserCaller.auth.approveDevicePairing({
        userCode: pairing.userCode.replace("-", ""),
      }),
    ).resolves.toMatchObject({ status: "approved" });

    const result = await tvCaller.auth.pollDevicePairing({
      userCode: pairing.userCode,
      deviceCode: pairing.deviceCode,
    });
    expect(result.status).toBe("approved");
    if (result.status === "approved") {
      expect(result.token).toEqual(expect.any(String));
    }

    sqlite.close();
  });
});
