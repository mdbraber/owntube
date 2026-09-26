import assert from "node:assert/strict";
import { test } from "node:test";
import { callbackIsPublic, isPublicAddress } from "./safety.ts";

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
