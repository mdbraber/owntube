import { describe, expect, it } from "vitest";
import { Player } from "youtubei.js";
import type { Egress } from "./egress.ts";
import { type AddressPolicy, SessionPool } from "./session.ts";

const egress: Egress = { fetch: () => globalThis.fetch, close: async () => {} };
const botCheck = {
  kind: "bot-check",
  reason: "Sign in to confirm you’re not a bot",
} as const;

function pool(
  overrides: Partial<ConstructorParameters<typeof SessionPool>[0]> = {},
) {
  let clock = 0;
  let made = 0;
  const p = new SessionPool({
    egress,
    createVisitorData: async () => `VD${++made}`,
    loadPlayer: async () => new Player(`p${clock}`, 20_000 + clock),
    now: () => clock,
    ...overrides,
  });
  const advance = (ms: number): void => {
    clock += ms;
  };
  return { p, advance, made: () => made };
}

describe("SessionPool", () => {
  it("shares one bootstrap between concurrent callers", async () => {
    const { p, made } = pool();
    const [a, b] = await Promise.all([p.session(), p.session()]);
    expect(a).toBe(b);
    expect(made()).toBe(1);
  });

  it("replaces a session that is too old", async () => {
    const { p, advance } = pool({ maxAgeMs: 1_000 });
    const first = await p.session();
    advance(999);
    expect(await p.session()).toBe(first);
    advance(1);
    expect((await p.session()).visitorData).toBe("VD2");
  });

  it("replaces a session after repeated bot checks, and flags its address", async () => {
    const flagged: Array<string | undefined> = [];
    const addresses: AddressPolicy = {
      next: () => "2001:db8::1",
      flag: (a) => flagged.push(a),
    };
    const { p } = pool({ maxStrikes: 2, addresses });
    const first = await p.session();
    p.report(first, botCheck);
    expect(await p.session()).toBe(first);
    p.report(first, botCheck);
    expect(flagged).toEqual(["2001:db8::1"]);
    expect(await p.session()).not.toBe(first);
  });

  it("retires a session at once when asked, flagging its address", async () => {
    const flagged: Array<string | undefined> = [];
    const { p } = pool({
      addresses: { next: () => "2001:db8::2", flag: (a) => flagged.push(a) },
    });
    const first = await p.session();
    p.retire(first);
    expect(flagged).toEqual(["2001:db8::2"]);
    expect(await p.session()).not.toBe(first);
  });

  it("forgives a bot check followed by a normal answer", async () => {
    const { p } = pool({ maxStrikes: 2 });
    const first = await p.session();
    p.report(first, botCheck);
    p.report(first, null);
    p.report(first, botCheck);
    expect(await p.session()).toBe(first);
  });

  it("ignores reports about a session it already replaced", async () => {
    const { p, advance } = pool({ maxAgeMs: 10, maxStrikes: 1 });
    const old = await p.session();
    advance(10);
    const current = await p.session();
    p.report(old, botCheck);
    expect(await p.session()).toBe(current);
  });

  it("retries after a failed bootstrap", async () => {
    let attempts = 0;
    const { p } = pool({
      createVisitorData: async () => {
        attempts++;
        if (attempts === 1) throw new Error("network");
        return "VD";
      },
    });
    await expect(p.session()).rejects.toThrow("network");
    expect((await p.session()).visitorData).toBe("VD");
  });

  it("reloads the player JS when it is too old", async () => {
    const { p, advance } = pool({ playerMaxAgeMs: 100 });
    const first = await p.player();
    expect(await p.player()).toBe(first);
    advance(100);
    expect(await p.player()).not.toBe(first);
  });
});
