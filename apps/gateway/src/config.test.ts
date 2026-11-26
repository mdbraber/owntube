import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({})).toEqual({
      host: "0.0.0.0",
      port: 8080,
      shutdownGraceMs: 10_000,
    });
  });

  it("reads the environment", () => {
    expect(
      loadConfig({ GATEWAY_PORT: "9000", GATEWAY_HOST: "127.0.0.1" }),
    ).toMatchObject({
      host: "127.0.0.1",
      port: 9000,
    });
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ GATEWAY_PORT: "70000" })).toThrow(
      /Invalid gateway configuration/,
    );
  });
});
