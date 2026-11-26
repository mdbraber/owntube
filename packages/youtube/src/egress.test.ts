import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEgress } from "./egress.ts";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/whoami" }).end();
    } else if (req.url === "/slow") {
      setTimeout(() => res.end("late"), 2_000);
    } else {
      res.end(req.socket.remoteAddress);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "::", resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("createEgress", () => {
  const egress = createEgress({ timeoutMs: 1_000 });
  afterAll(() => egress.close());

  it("leaves from the requested local address", async () => {
    const v4 = await (
      await egress.fetch("127.0.0.1")(
        `${base.replace("localhost", "127.0.0.1")}/whoami`,
      )
    ).text();
    expect(v4).toMatch(/127\.0\.0\.1$/);
    const v6 = await (
      await egress.fetch("::1")(`${base.replace("localhost", "[::1]")}/whoami`)
    ).text();
    expect(v6).toBe("::1");
  });

  it("reaches a dual-stack name over the family of the source address", async () => {
    const v4 = await (await egress.fetch("0.0.0.0")(`${base}/whoami`)).text();
    expect(v4).toMatch(/127\.0\.0\.1$/);
    const v6 = await (await egress.fetch("::")(`${base}/whoami`)).text();
    expect(v6).toBe("::1");
  });

  it("passes redirect: manual through", async () => {
    const res = await egress.fetch()(`${base}/redirect`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/whoami");
  });

  it("passes the caller's abort signal through", async () => {
    const controller = new AbortController();
    const pending = egress.fetch()(`${base}/slow`, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
  });

  it("gives up on a server that does not answer in time", async () => {
    await expect(egress.fetch()(`${base}/slow`)).rejects.toThrow();
  });
});
