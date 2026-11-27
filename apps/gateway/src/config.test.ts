import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  const KEY = { GATEWAY_SIGNING_KEY: "k".repeat(32) };

  it("applies defaults", () => {
    expect(loadConfig(KEY)).toEqual({
      host: "0.0.0.0",
      port: 8080,
      shutdownGraceMs: 10_000,
      signingKey: "k".repeat(32),
      transport: "auto",
      egressFamily: "auto",
      cacheDir: "data/cache",
      imageCacheMaxBytes: 1024 * 1024 * 1024,
    });
  });

  it("requires a signing key", () => {
    expect(() => loadConfig({})).toThrow(/GATEWAY_SIGNING_KEY|signingKey/);
  });

  it("rejects the example placeholder in production only", () => {
    const placeholder = {
      GATEWAY_SIGNING_KEY: "change-me-to-a-long-random-value",
    };
    expect(() =>
      loadConfig({ ...placeholder, NODE_ENV: "production" }),
    ).toThrow(/placeholder/);
    expect(loadConfig(placeholder).signingKey).toBe(
      placeholder.GATEWAY_SIGNING_KEY,
    );
  });

  it("treats empty optional settings as unset", () => {
    expect(
      loadConfig({
        ...KEY,
        GATEWAY_TRANSPORT: "",
        GATEWAY_PROXY_URL: "",
        GATEWAY_IMAGE_CACHE_MAX_BYTES: "",
        GATEWAY_PO_BROWSER: "",
      }),
    ).toMatchObject({ transport: "auto", imageCacheMaxBytes: 1024 ** 3 });
  });

  it("reads the environment", () => {
    expect(
      loadConfig({ ...KEY, GATEWAY_PORT: "9000", GATEWAY_HOST: "127.0.0.1" }),
    ).toMatchObject({
      host: "127.0.0.1",
      port: 9000,
    });
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ ...KEY, GATEWAY_PORT: "70000" })).toThrow(
      /Invalid gateway configuration/,
    );
  });
});
