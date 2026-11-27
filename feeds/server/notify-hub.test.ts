import assert from "node:assert/strict";
import { test } from "node:test";
import { hubTopicUrls, notifyHub } from "./notify-hub.ts";

const PUBLIC = "https://owntube.example";
const ALICE_TOKEN = "a".repeat(32);

test("hubTopicUrls builds the secret address for each variant, no username", () => {
  assert.deepEqual(
    hubTopicUrls(
      PUBLIC,
      { owner: "m@example.com", kind: "playlist", slug: "tech talks" },
      ALICE_TOKEN,
    ),
    [
      `https://owntube.example/rss/${ALICE_TOKEN}/playlist/tech%20talks.audio.xml`,
      `https://owntube.example/rss/${ALICE_TOKEN}/playlist/tech%20talks.video.xml`,
    ],
  );
});

test("notifyHub posts one hub.url per variant of each changed feed", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("accepted", { status: 202 });
  }) as unknown as typeof fetch;
  await notifyHub(
    { publicUrl: PUBLIC, publishUrl: "http://hub:8080/", token: "tok" },
    [{ owner: "alice", kind: "queue", slug: "queue" }],
    () => ALICE_TOKEN,
    fakeFetch,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://hub:8080/");
  assert.equal(
    (calls[0].init.headers as Record<string, string>).authorization,
    "Bearer tok",
  );
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.equal(body.get("hub.mode"), "publish");
  assert.deepEqual(
    body.getAll("hub.url"),
    hubTopicUrls(
      PUBLIC,
      { owner: "alice", kind: "queue", slug: "queue" },
      ALICE_TOKEN,
    ),
  );
});

test("notifyHub skips feeds whose owner has no token", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("accepted", { status: 202 });
  }) as unknown as typeof fetch;
  const tokenFor = (owner: string) => (owner === "alice" ? ALICE_TOKEN : null);
  await notifyHub(
    { publicUrl: PUBLIC, publishUrl: "http://hub/", token: "tok" },
    [
      { owner: "alice", kind: "queue", slug: "queue" },
      { owner: "bob", kind: "queue", slug: "queue" },
    ],
    tokenFor,
    fakeFetch,
  );
  assert.equal(calls.length, 1);
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.deepEqual(
    body.getAll("hub.url"),
    hubTopicUrls(
      PUBLIC,
      { owner: "alice", kind: "queue", slug: "queue" },
      ALICE_TOKEN,
    ),
  );
});

test("notifyHub sends nothing when no changed feed's owner has a token", async () => {
  let called = false;
  const fakeFetch = (async () => {
    called = true;
    return new Response("accepted", { status: 202 });
  }) as unknown as typeof fetch;
  await notifyHub(
    { publicUrl: PUBLIC, publishUrl: "http://hub/", token: "tok" },
    [{ owner: "bob", kind: "queue", slug: "queue" }],
    () => null,
    fakeFetch,
  );
  assert.equal(called, false);
});

test("notifyHub chunks announcements into POSTs of at most 100 hub.url values", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("accepted", { status: 202 });
  }) as unknown as typeof fetch;
  const feeds = Array.from({ length: 60 }, (_, i) => ({
    owner: "alice",
    kind: "playlist",
    slug: `list-${i}`,
  }));
  await notifyHub(
    { publicUrl: PUBLIC, publishUrl: "http://hub/", token: "tok" },
    feeds,
    () => ALICE_TOKEN,
    fakeFetch,
  );
  assert.equal(calls.length, 2);
  const urlsPerCall = calls.map((c) =>
    new URLSearchParams(String(c.init.body)).getAll("hub.url"),
  );
  assert.equal(urlsPerCall[0].length, 100);
  assert.equal(urlsPerCall[1].length, 20);
  const allUrls = feeds.flatMap((feed) =>
    hubTopicUrls(PUBLIC, feed, ALICE_TOKEN),
  );
  assert.deepEqual([...urlsPerCall[0], ...urlsPerCall[1]], allUrls);
});

test("notifyHub sends nothing for no changes and throws on hub errors", async () => {
  let called = false;
  const ok = (async () => {
    called = true;
    return new Response("", { status: 202 });
  }) as unknown as typeof fetch;
  await notifyHub(
    { publicUrl: PUBLIC, publishUrl: "http://hub/", token: "t" },
    [],
    () => ALICE_TOKEN,
    ok,
  );
  assert.equal(called, false);

  const failing = (async () =>
    new Response("no", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(
    notifyHub(
      { publicUrl: PUBLIC, publishUrl: "http://hub/", token: "t" },
      [{ owner: "a", kind: "queue", slug: "queue" }],
      () => ALICE_TOKEN,
      failing,
    ),
    /hub 500/,
  );
});
