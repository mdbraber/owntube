import { afterEach, describe, expect, it } from "vitest";
import { resolveAppOriginFromHeaders } from "@/lib/app-public-origin";

describe("resolveAppOriginFromHeaders", () => {
  afterEach(() => {
    delete process.env.APP_BASE_URL;
  });

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
