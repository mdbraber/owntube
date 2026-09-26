import assert from "node:assert/strict";
import { test } from "node:test";
import { feedTopicUrl, hubTopicUrls, notifyHub } from "./notify-hub.ts";

const PUBLIC = "https://owntube.example";

test("topic URLs carry the encoded username, and the password when given", () => {
  assert.equal(
    feedTopicUrl(PUBLIC, "m@example.com", "/rss/queue/queue.audio.xml", "p:w"),
    "https://m%40example.com:p%3Aw@owntube.example/rss/queue/queue.audio.xml",
  );
  assert.deepEqual(hubTopicUrls(PUBLIC, { owner: "m@example.com", kind: "playlist", slug: "tech talks" }), [
    "https://m%40example.com@owntube.example/rss/playlist/tech%20talks.audio.xml",
    "https://m%40example.com@owntube.example/rss/playlist/tech%20talks.video.xml",
  ]);
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
    fakeFetch,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://hub:8080/");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer tok");
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.equal(body.get("hub.mode"), "publish");
  assert.deepEqual(body.getAll("hub.url"), hubTopicUrls(PUBLIC, { owner: "alice", kind: "queue", slug: "queue" }));
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
  await notifyHub({ publicUrl: PUBLIC, publishUrl: "http://hub/", token: "tok" }, feeds, fakeFetch);
  assert.equal(calls.length, 2);
  const urlsPerCall = calls.map((c) => new URLSearchParams(String(c.init.body)).getAll("hub.url"));
  assert.equal(urlsPerCall[0].length, 100);
  assert.equal(urlsPerCall[1].length, 20);
  const allUrls = feeds.flatMap((feed) => hubTopicUrls(PUBLIC, feed));
  assert.deepEqual([...urlsPerCall[0], ...urlsPerCall[1]], allUrls);
});

test("notifyHub sends nothing for no changes and throws on hub errors", async () => {
  let called = false;
  const ok = (async () => {
    called = true;
    return new Response("", { status: 202 });
  }) as unknown as typeof fetch;
  await notifyHub({ publicUrl: PUBLIC, publishUrl: "http://hub/", token: "t" }, [], ok);
  assert.equal(called, false);

  const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(
    notifyHub({ publicUrl: PUBLIC, publishUrl: "http://hub/", token: "t" }, [{ owner: "a", kind: "queue", slug: "queue" }], failing),
    /hub 500/,
  );
});
