import { describe, expect, it } from "vitest";
import { evaluatePlayerScript } from "./decipher.ts";

const script = (body: string) =>
  ({ output: body }) as Parameters<typeof evaluatePlayerScript>[0];

describe("evaluatePlayerScript", () => {
  const exported = `var exportedVars = {
    nFunction: (n) => n.split("").reverse().join(""),
    sigFunction: (s) => s + "!",
  };`;

  it("runs the player's n and signature functions", () => {
    expect(
      evaluatePlayerScript(script(exported), { n: "abc", sig: "xyz" }),
    ).toEqual({ n: "cba", sig: "xyz!" });
  });

  it("quotes inputs instead of splicing them into code", () => {
    const hostile = '");throw 1;("';
    expect(evaluatePlayerScript(script(exported), { n: hostile }).n).toBe(
      [...hostile].reverse().join(""),
    );
  });

  it("gives the script none of our globals", () => {
    const probe = script(
      `var exportedVars = { nFunction: () => typeof process + "/" + typeof require };`,
    );
    expect(evaluatePlayerScript(probe, { n: "x" }).n).toBe(
      "undefined/undefined",
    );
  });

  it("stops a script that does not finish", () => {
    const loop = script(
      `var exportedVars = { nFunction: () => { for (;;) {} } };`,
    );
    expect(() => evaluatePlayerScript(loop, { n: "x" })).toThrow(/timed out/);
  });
});
