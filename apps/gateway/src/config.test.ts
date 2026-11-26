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
    });
  });

  it("requires a signing key", () => {
    expect(() => loadConfig({})).toThrow(/GATEWAY_SIGNING_KEY|signingKey/);
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
