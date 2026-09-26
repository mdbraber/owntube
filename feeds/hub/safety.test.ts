import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import {
  callbackIsPublic,
  isPublicAddress,
  publicOnlyFetch,
  publicOnlyLookup,
} from "./safety.ts";

test("private, loopback, link-local and mapped addresses are not public", () => {
  for (const ip of [
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:192.168.1.1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress("not an ip"), false);
});

test("public addresses are public", () => {
  for (const ip of ["8.8.8.8", "142.132.230.73", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test("callbackIsPublic resolves names and requires every address to be public", async () => {
  const lookup = async (host: string) =>
    ({ pub: ["8.8.8.8"], mixed: ["8.8.8.8", "10.0.0.1"], none: [] })[host] ?? [];
  assert.equal(await callbackIsPublic("https://pub/cb", lookup), true);
  assert.equal(await callbackIsPublic("https://mixed/cb", lookup), false);
  assert.equal(await callbackIsPublic("https://none/cb", lookup), false);
  assert.equal(await callbackIsPublic("http://10.0.0.1/cb", lookup), false);
  assert.equal(await callbackIsPublic("http://[::1]/cb", lookup), false);
  assert.equal(await callbackIsPublic("ftp://pub/cb", lookup), false);
  assert.equal(await callbackIsPublic("not a url", lookup), false);
});

function runLookup(
  lookup: ReturnType<typeof publicOnlyLookup>,
  host: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    lookup(host, options, (err: Error | null, ...rest: unknown[]) => {
      if (err) reject(err);
      else resolve(rest.length === 1 ? rest[0] : rest);
    });
  });
}

test("publicOnlyLookup rejects a private address, options.all === true", async () => {
  const resolve = async () => [{ address: "10.0.0.5", family: 4 }];
  const lookup = publicOnlyLookup(resolve);
  await assert.rejects(() => runLookup(lookup, "evil.example", { all: true }));
});

test("publicOnlyLookup rejects a private address, single-address form", async () => {
  const resolve = async () => [{ address: "127.0.0.1", family: 4 }];
  const lookup = publicOnlyLookup(resolve);
  await assert.rejects(() => runLookup(lookup, "evil.example", {}));
});

test("publicOnlyLookup accepts public addresses, options.all === true", async () => {
  const resolve = async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "2001:4860:4860::8888", family: 6 },
  ];
  const lookup = publicOnlyLookup(resolve);
  const result = await runLookup(lookup, "good.example", { all: true });
  assert.deepEqual(result, [
    { address: "8.8.8.8", family: 4 },
    { address: "2001:4860:4860::8888", family: 6 },
  ]);
});

test("publicOnlyLookup accepts a public address, single-address form", async () => {
  const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
  const lookup = publicOnlyLookup(resolve);
  const [address, family] = (await runLookup(lookup, "good.example", {})) as [string, number];
  assert.equal(address, "8.8.8.8");
  assert.equal(family, 4);
});

test("publicOnlyLookup rejects when any of several addresses is private, options.all === true", async () => {
  const resolve = async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ];
  const lookup = publicOnlyLookup(resolve);
  await assert.rejects(() => runLookup(lookup, "mixed.example", { all: true }));
});

test("publicOnlyFetch refuses to connect to localhost (loopback address)", async () => {
  const server = http.createServer((_req, res) => res.end("hello"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try {
    // Assert why it failed, not just that it did — otherwise a connection
    // refused (e.g. from a typo'd port) would pass this just as well as the
    // rebinding guard actually firing.
    await assert.rejects(() => publicOnlyFetch(`http://localhost:${port}/`), (error: unknown) => {
      assert.ok(error instanceof Error);
      const cause = (error as Error & { cause?: unknown }).cause;
      assert.match(String((cause as Error)?.message ?? cause), /non-public/);
      return true;
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
