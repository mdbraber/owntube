import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type HubResult, Hub } from "./hub.ts";
import { SubscriptionStore } from "./store.ts";
import { topicKey } from "./topic.ts";

type Received = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
};

async function listen(
  handler: (req: Received, res: http.ServerResponse) => void,
) {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const r: Received = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      received.push(r);
      handler(r, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    received,
    posts: () => received.filter((r) => r.method === "POST"),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A subscriber that confirms verification by echoing the challenge and
 * answers content deliveries with `deliveryStatus`. */
function subscriber(deliveryStatus = 200) {
  return listen((r, res) => {
    if (r.method === "GET") {
      const challenge =
        new URL(r.url, "http://x").searchParams.get("hub.challenge") ?? "";
      res.writeHead(200);
      res.end(challenge);
      return;
    }
    res.writeHead(deliveryStatus);
    res.end();
  });
}

/** A feeds server with per-user content behind Basic Auth. */
function topicServer() {
  const users: Record<string, string> = { alice: "pw-a", bob: "pw-b" };
  return listen((r, res) => {
    const m = (r.headers.authorization ?? "").match(/^Basic (.+)$/);
    const [user, pass] = m
      ? Buffer.from(m[1], "base64").toString("utf8").split(":")
      : [];
    if (!user || users[user] !== pass) {
      res.writeHead(401);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/rss+xml" });
    res.end(`<rss>${user}</rss>`);
  });
}

function freshHub(overrides: Partial<ConstructorParameters<typeof Hub>[0]> = {}) {
  const store = new SubscriptionStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "websub-hub-")),
  );
  let now = 1_800_000_000;
  const hub = new Hub({
    store,
    hubUrl: "https://websub.example/",
    publishToken: "tok",
    topicHosts: ["127.0.0.1"],
    isCallbackAllowed: async () => true,
    now: () => now,
    retryDelaysMs: [0],
    log: () => {},
    ...overrides,
  });
  return { hub, store, now: () => now, advance: (s: number) => { now += s; } };
}

function form(fields: Record<string, string | string[]>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    for (const value of Array.isArray(v) ? v : [v]) params.append(k, value);
  }
  return params;
}

async function settle(result: HubResult): Promise<HubResult> {
  if (result.after) await result.after();
  return result;
}

const FEED = "/rss/queue/queue.audio.xml";

test("a verified subscribe is stored with a clamped lease", async () => {
  const sub = await subscriber();
  const { hub, store, now } = freshHub();
  const topic = `http://alice:pw-a@127.0.0.1:1${FEED}`;
  const result = await settle(
    await hub.handle(
      form({
        "hub.mode": "subscribe",
        "hub.callback": `${sub.base}/cb?id=7`,
        "hub.topic": topic,
        "hub.lease_seconds": "99999999",
      }),
    ),
  );
  assert.equal(result.status, 202);
  const verify = new URL(sub.received[0].url, "http://x");
  assert.equal(verify.searchParams.get("id"), "7");
  assert.equal(verify.searchParams.get("hub.mode"), "subscribe");
  assert.equal(verify.searchParams.get("hub.topic"), topic);
  assert.equal(verify.searchParams.get("hub.lease_seconds"), "2592000");
  const active = store.active(topicKey(topic) as string, now());
  assert.equal(active.length, 1);
  assert.equal(active[0].expiresAt, now() + 2592000);
  await sub.close();
});

test("a subscriber that does not echo the challenge is not stored", async () => {
  const sub = await listen((_r, res) => {
    res.writeHead(200);
    res.end("nope");
  });
  const { hub, store, now } = freshHub();
  const topic = `http://alice:pw-a@127.0.0.1:1${FEED}`;
  await settle(
    await hub.handle(
      form({ "hub.mode": "subscribe", "hub.callback": `${sub.base}/cb`, "hub.topic": topic }),
    ),
  );
  assert.equal(store.active(topicKey(topic) as string, now()).length, 0);
  await sub.close();
});

test("subscribe is refused for foreign topics, private callbacks and long secrets", async () => {
  const { hub } = freshHub({
    isCallbackAllowed: async (cb) => !cb.includes("10.0.0.1"),
  });
  const base = { "hub.mode": "subscribe", "hub.callback": "https://pc.example/cb" };
  const foreign = await hub.handle(form({ ...base, "hub.topic": "https://evil.example/feed" }));
  assert.equal(foreign.status, 400);
  const privateCb = await hub.handle(
    form({ ...base, "hub.callback": "http://10.0.0.1/cb", "hub.topic": `http://127.0.0.1${FEED}` }),
  );
  assert.equal(privateCb.status, 400);
  const longSecret = await hub.handle(
    form({ ...base, "hub.topic": `http://127.0.0.1${FEED}`, "hub.secret": "x".repeat(200) }),
  );
  assert.equal(longSecret.status, 400);
  const badMode = await hub.handle(form({ "hub.mode": "list" }));
  assert.equal(badMode.status, 400);
});

test("publish needs the bearer token", async () => {
  const { hub } = freshHub();
  const res = await hub.handle(
    form({ "hub.mode": "publish", "hub.url": `http://alice@127.0.0.1${FEED}` }),
    "Bearer wrong",
  );
  assert.equal(res.status, 401);
});

test("publish delivers the feed fetched with the subscriber's credentials, signed", async () => {
  const feeds = await topicServer();
  const sub = await subscriber();
  const { hub } = freshHub();
  const topic = `http://alice:pw-a@127.0.0.1:${feeds.port}${FEED}`;
  await settle(
    await hub.handle(
      form({
        "hub.mode": "subscribe",
        "hub.callback": `${sub.base}/cb`,
        "hub.topic": topic,
        "hub.secret": "s3cret",
      }),
    ),
  );
  const result = await settle(
    await hub.handle(
      form({ "hub.mode": "publish", "hub.url": `http://alice@127.0.0.1:${feeds.port}${FEED}` }),
      "Bearer tok",
    ),
  );
  assert.equal(result.status, 202);
  const [delivery] = sub.posts();
  assert.equal(delivery.body, "<rss>alice</rss>");
  assert.equal(delivery.headers["content-type"], "application/rss+xml");
  assert.equal(
    delivery.headers["x-hub-signature"],
    `sha256=${createHmac("sha256", "s3cret").update("<rss>alice</rss>").digest("hex")}`,
  );
  assert.match(String(delivery.headers.link), /<https:\/\/websub\.example\/>; rel="hub"/);
  await Promise.all([feeds.close(), sub.close()]);
});

test("the topic is fetched with topicFetch, not fetch", async () => {
  const feeds = await topicServer();
  const sub = await subscriber();
  const { hub } = freshHub({
    fetch: async (input, init) => {
      const href = typeof input === "string" ? input : input.toString();
      if (href.includes(`:${feeds.port}`)) {
        throw new Error("fetch must not be used for the topic request");
      }
      return fetch(input, init);
    },
    topicFetch: fetch,
  });
  const topic = `http://alice:pw-a@127.0.0.1:${feeds.port}${FEED}`;
  await settle(
    await hub.handle(
      form({ "hub.mode": "subscribe", "hub.callback": `${sub.base}/cb`, "hub.topic": topic }),
    ),
  );
  const result = await settle(
    await hub.handle(
      form({ "hub.mode": "publish", "hub.url": `http://alice@127.0.0.1:${feeds.port}${FEED}` }),
      "Bearer tok",
    ),
  );
  assert.equal(result.status, 202);
  const [delivery] = sub.posts();
  assert.equal(delivery.body, "<rss>alice</rss>");
  await Promise.all([feeds.close(), sub.close()]);
});

test("announcing one user's feed never reaches another user's subscriber", async () => {
  const feeds = await topicServer();
  const alice = await subscriber();
  const bob = await subscriber();
  const { hub } = freshHub();
  for (const [s, cred] of [
    [alice, "alice:pw-a"],
    [bob, "bob:pw-b"],
  ] as const) {
    await settle(
      await hub.handle(
        form({
          "hub.mode": "subscribe",
          "hub.callback": `${s.base}/cb`,
          "hub.topic": `http://${cred}@127.0.0.1:${feeds.port}${FEED}`,
        }),
      ),
    );
  }
  await settle(
    await hub.handle(
      form({ "hub.mode": "publish", "hub.url": `http://alice@127.0.0.1:${feeds.port}${FEED}` }),
      "Bearer tok",
    ),
  );
  assert.equal(alice.posts().length, 1);
  assert.equal(alice.posts()[0].body, "<rss>alice</rss>");
  assert.equal(bob.posts().length, 0);
  await Promise.all([feeds.close(), alice.close(), bob.close()]);
});

test("a callback answering 410 Gone is unsubscribed; failures retry then give up", async () => {
  const feeds = await topicServer();
  const gone = await subscriber(410);
  const failing = await subscriber(500);
  const { hub, store, now } = freshHub();
  const topic = `http://alice:pw-a@127.0.0.1:${feeds.port}${FEED}`;
  for (const s of [gone, failing]) {
    await settle(
      await hub.handle(
        form({ "hub.mode": "subscribe", "hub.callback": `${s.base}/cb`, "hub.topic": topic }),
      ),
    );
  }
  await settle(
    await hub.handle(
      form({ "hub.mode": "publish", "hub.url": `http://alice@127.0.0.1:${feeds.port}${FEED}` }),
      "Bearer tok",
    ),
  );
  assert.equal(gone.posts().length, 1);
  assert.equal(failing.posts().length, 2); // first try + one retry (retryDelaysMs: [0])
  assert.deepEqual(
    store.active(topicKey(topic) as string, now()).map((s) => s.callback),
    [`${failing.base}/cb`],
  );
  await Promise.all([feeds.close(), gone.close(), failing.close()]);
});

test("expired subscriptions and callbacks that turned private get nothing", async () => {
  const feeds = await topicServer();
  const sub = await subscriber();
  let allow = true;
  const { hub, advance } = freshHub({ isCallbackAllowed: async () => allow });
  const topic = `http://alice:pw-a@127.0.0.1:${feeds.port}${FEED}`;
  await settle(
    await hub.handle(
      form({
        "hub.mode": "subscribe",
        "hub.callback": `${sub.base}/cb`,
        "hub.topic": topic,
        "hub.lease_seconds": "3600",
      }),
    ),
  );
  const publish = () =>
    hub.handle(
      form({ "hub.mode": "publish", "hub.url": `http://alice@127.0.0.1:${feeds.port}${FEED}` }),
      "Bearer tok",
    );
  allow = false;
  await settle(await publish());
  assert.equal(sub.posts().length, 0);
  allow = true;
  advance(3600);
  await settle(await publish());
  assert.equal(sub.posts().length, 0);
  await Promise.all([feeds.close(), sub.close()]);
});

test("a verified unsubscribe removes the subscription", async () => {
  const sub = await subscriber();
  const { hub, store, now } = freshHub();
  const topic = `http://alice:pw-a@127.0.0.1:1${FEED}`;
  for (const mode of ["subscribe", "unsubscribe"]) {
    await settle(
      await hub.handle(
        form({ "hub.mode": mode, "hub.callback": `${sub.base}/cb`, "hub.topic": topic }),
      ),
    );
  }
  assert.equal(store.active(topicKey(topic) as string, now()).length, 0);
  await sub.close();
});
