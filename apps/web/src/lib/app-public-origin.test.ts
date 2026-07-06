import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAppOriginFromHeaders } from "@/lib/app-public-origin";

describe("resolveAppOriginFromHeaders", () => {
  // appOriginFromEnv reads all three; a real deployment sets some of them, which
  // would leak into the "unset" case — clear them before and after each test.
  const ORIGIN_ENV = ["APP_BASE_URL", "NEXTAUTH_URL", "AUTH_URL"] as const;
  const clearOriginEnv = () => {
    for (const key of ORIGIN_ENV) delete process.env[key];
  };
  beforeEach(clearOriginEnv);
  afterEach(clearOriginEnv);

  it("prefers APP_BASE_URL over Host header", () => {
    process.env.APP_BASE_URL = "http://192.168.1.14:3000";
    const origin = resolveAppOriginFromHeaders({
      get: (name) => (name === "host" ? "0.0.0.0:3000" : null),
    });
    expect(origin).toBe("http://192.168.1.14:3000");
  });

  it("rejects 0.0.0.0 Host when APP_BASE_URL is unset", () => {
    const origin = resolveAppOriginFromHeaders({
      get: (name) => (name === "host" ? "0.0.0.0:3000" : null),
    });
    expect(origin).toBe("http://localhost:3000");
  });
});
