# WebSub Hub and In-App Feed Publisher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pocket Casts learns about changed OwnTube podcast feeds within about a minute, through a self-hosted WebSub hub, and the separate feeds-pusher container is gone.

**Architecture:** The OwnTube web app (home, naggon) publishes feed snapshots itself: it polls the `feed_publish_state` row every 10 seconds and publishes after a 30-second quiet period (or 2 minutes into a burst, or every 30 minutes regardless). The public feeds server (spiff, `owntube.nedworks.org`) stores the snapshots as before, now reports which feeds actually changed, advertises `https://websub.nedworks.org/` as its hub, and tells the hub which feeds changed. The hub (spiff, `websub.nedworks.org`) is a small standalone service: it verifies subscriptions, fetches each changed feed with the subscriber's own credentials, and pushes it to the subscriber, signed.

**Tech Stack:** Node 22, TypeScript run via `tsx`, `better-sqlite3`, plain `node:http` (feeds server and hub), `node:test` (feeds server and hub tests), Next.js 15 + drizzle-orm + vitest (web app).

**Spec:** Agreed in conversation on 2026-09-26; the decisions are recorded under "Design decisions" below. WebSub reference: https://www.w3.org/TR/websub/

## Design decisions

1. **Hub lives at `websub.nedworks.org`, separate from the feeds server.** DNS already resolves to spiff.
2. **Topic URLs carry the feed's credentials.** Feeds are per user but share paths (every user has `/rss/queue/queue.audio.xml`), and the hub must fetch a feed to deliver it. So the feed's `<atom:link rel="self">` becomes `https://<user>:<pass>@owntube.nedworks.org/rss/...` (built from the request's own Basic Auth), Pocket Casts subscribes with that as `hub.topic`, and the hub fetches it with those credentials. Only the subscriber and our own hub ever see it.
3. **Topics match on user + URL, never on password.** The feeds server doesn't know plaintext passwords (it stores SHA-256 digests), so it announces `https://<user>@owntube.nedworks.org/rss/...`; the hub matches that against subscriptions ignoring the password, with the username percent-decoded and path segments normalised.
4. **Only changed feeds are announced.** A feed counts as changed when its snapshot differs from the stored one ignoring `updatedAt` (most feeds stamp `updatedAt = now` on every build).
5. **The pusher container is replaced by a loop inside the web app**, started from `instrumentation.ts` only when `OWNTUBE_PUBLISH_TARGET` and `OWNTUBE_PUBLISH_SECRET` are set.
6. **The 48-hour watch-history replay stays, moved into the same loop.** Correction to the conversation: the n8n 6-hour replay flow (`pocket-sessions/server/n8n/mesh-replay-cron.json`) calls pocket-sessions' `/api/v1/hooks/replay`, which re-delivers Pocket Casts → OwnTube only. The OwnTube → Pocket Casts direction is healed solely by `replayRecentHistory`, so dropping it would lose outage recovery in that direction.

## Global Constraints

- Node `>=22 <23` for the feeds server and hub (`engines` in their `package.json`).
- Hub environment: `HUB_URL=https://websub.nedworks.org/`, `HUB_TOPIC_HOSTS=owntube.nedworks.org`, `HUB_PUBLISH_TOKEN` (required, from `.env`).
- Feeds server environment (new, all optional; hub support is on only when all three are set): `HUB_URL=https://websub.nedworks.org/`, `HUB_PUBLISH_TOKEN` (same value as the hub's), `PUBLIC_URL=https://owntube.nedworks.org`. Optional `HUB_PUBLISH_URL=http://websub-hub:8080/` (internal Docker address; defaults to `HUB_URL`).
- Web app environment (moved from the pusher container): `OWNTUBE_PUBLISH_TARGET`, `OWNTUBE_PUBLISH_SECRET`, optional `OWNTUBE_PUBLISH_INTERVAL_SEC` (default `1800`), `OWNTUBE_APP_URL`. `OWNTUBE_PUBLISH_SECRET` must be set on the **prod** container only: dev and prod share one SQLite database, and two publishers would race. `OWNTUBE_PUBLISH_TARGET` may legitimately be set on dev too — `settings.ts` reads it to build the settings UI's copyable feed URLs regardless of whether that container publishes.
- Lease: default 864000 s (10 days), clamped to 3600–2592000 s. `hub.secret` must be under 200 bytes (WebSub §5.1).
- Signatures: `X-Hub-Signature: sha256=<hex HMAC-SHA256 of the body>`.
- Match surrounding style: feeds server and hub use `node:test` + `assert/strict` files run with `tsx`; the web app uses vitest `describe/it/expect` next to the source file.

## Review Focus

1. **Pocket Casts subscribes with differently encoded topic URLs** (`m%40mdbraber.com` vs `m@mdbraber.com` in the username, `%2f` vs `%2F` in the path) — the subscription must still match the feeds server's announcement. Pinned in Task 1 (`topicKey` tests).
2. **Two users with the same feed path** — announcing alice's queue must never deliver bob's feed, or deliver anything to bob's subscriber. Pinned in Task 3.
3. **A callback URL pointing at an internal address** (`http://10.0.0.1/`, `http://[::ffff:192.168.1.1]/`, a hostname resolving to loopback) — the hub must refuse it at subscribe time and skip it at delivery time. Pinned in Tasks 2 and 3.
4. **The hub is down or rejects the announcement** — the feeds server's `/publish` must still succeed and store the snapshots. Pinned in Task 5 (`notifyHub` throws; `server.ts` only logs).
5. **The feeds server is unreachable from home** — the in-app publisher must not mark feeds published, must retry after 60 s rather than every 10 s, and a write landing in the same second a publish starts must still be published. Pinned in Task 6.

---

### Task 1: Hub topic handling and subscription store

**Files:**
- Create: `feeds/hub/package.json`, `feeds/hub/tsconfig.json`
- Create: `feeds/hub/topic.ts`, `feeds/hub/topic.test.ts`
- Create: `feeds/hub/store.ts`, `feeds/hub/store.test.ts`

**Interfaces:**
- Produces:
  - `topicKey(topic: string): string | null` — match key, `null` for non-http(s) or unparsable URLs.
  - `topicHostname(topic: string): string | null`
  - `fetchTarget(topic: string): { url: string; authorization?: string }` — credential-free URL plus a Basic `Authorization` header value.
  - `redact(topic: string): string` — topic with the password replaced by `***`, for logs.
  - `type Subscription = { callback: string; topic: string; secret: string | null; leaseSeconds: number; expiresAt: number }`
  - `class SubscriptionStore { constructor(dataDir: string); upsert(sub: Subscription): void; remove(callback: string, topic: string): boolean; active(key: string, now: number): Subscription[]; pruneExpired(now: number): number }`

- [ ] **Step 1: Scaffold the package**

`feeds/hub/package.json`:

```json
{
  "name": "websub-hub",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Minimal WebSub hub for OwnTube's podcast feeds (websub.nedworks.org)",
  "scripts": {
    "start": "tsx server.ts",
    "test": "tsx topic.test.ts && tsx store.test.ts && tsx safety.test.ts && tsx hub.test.ts"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.0"
  },
  "engines": {
    "node": ">=22 <23"
  }
}
```

Copy `feeds/server/tsconfig.json` to `feeds/hub/tsconfig.json` unchanged. Then:

Run: `cd feeds/hub && npm install`
Expected: installs, writes `package-lock.json`.

- [ ] **Step 2: Write the failing topic tests**

`feeds/hub/topic.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchTarget, redact, topicHostname, topicKey } from "./topic.ts";

const PATH = "/rss/queue/queue.audio.xml";

test("the password never takes part in matching", () => {
  assert.equal(
    topicKey(`https://alice:secret@owntube.example${PATH}`),
    topicKey(`https://alice@owntube.example${PATH}`),
  );
  assert.equal(
    topicKey(`https://alice:secret@owntube.example${PATH}`),
    topicKey(`https://alice:other@owntube.example${PATH}`),
  );
});

test("the username does take part: two users' feeds share a path", () => {
  assert.notEqual(
    topicKey(`https://alice@owntube.example${PATH}`),
    topicKey(`https://bob@owntube.example${PATH}`),
  );
  assert.notEqual(
    topicKey(`https://alice@owntube.example${PATH}`),
    topicKey(`https://owntube.example${PATH}`),
  );
});

test("encoding differences in username and path still match", () => {
  assert.equal(
    topicKey(`https://m%40example.com:pw@owntube.example${PATH}`),
    topicKey(`https://m@example.com:pw@owntube.example${PATH}`),
  );
  assert.equal(
    topicKey("https://a@owntube.example/rss/playlist/r%c3%a9sum%c3%a9.audio.xml"),
    topicKey("https://a@owntube.example/rss/playlist/r%C3%A9sum%C3%A9.audio.xml"),
  );
  assert.equal(
    topicKey("https://a@OwnTube.Example/rss/q.xml"),
    topicKey("https://a@owntube.example/rss/q.xml"),
  );
});

test("non-http topics are rejected", () => {
  assert.equal(topicKey("ftp://owntube.example/x"), null);
  assert.equal(topicKey("not a url"), null);
  assert.equal(topicHostname("not a url"), null);
  assert.equal(topicHostname(`https://a:b@owntube.example:8443${PATH}`), "owntube.example");
});

test("fetchTarget moves credentials into a Basic header", () => {
  const t = fetchTarget(`https://m%40example.com:p%3Ass@owntube.example${PATH}`);
  assert.equal(t.url, `https://owntube.example${PATH}`);
  assert.equal(
    t.authorization,
    `Basic ${Buffer.from("m@example.com:p:ss").toString("base64")}`,
  );
  assert.deepEqual(fetchTarget(`https://owntube.example${PATH}`), {
    url: `https://owntube.example${PATH}`,
  });
});

test("redact hides the password only", () => {
  assert.equal(
    redact(`https://alice:secret@owntube.example${PATH}`),
    `https://alice:***@owntube.example${PATH}`,
  );
  assert.equal(redact(`https://owntube.example${PATH}`), `https://owntube.example${PATH}`);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd feeds/hub && npx tsx topic.test.ts`
Expected: FAIL — `Cannot find module './topic.ts'`.

- [ ] **Step 4: Implement `topic.ts`**

`feeds/hub/topic.ts`:

```ts
/**
 * Topic URLs, as this hub sees them.
 *
 * OwnTube's feeds are per user but share paths — every user has
 * /rss/queue/queue.audio.xml — so a feed's topic URL carries the user's
 * credentials (https://user:pass@host/rss/...). That makes each topic unique
 * per user and lets the hub fetch it. The publisher (the feeds server) only
 * knows the username, never the plaintext password, so matching ignores the
 * password and normalises the encodings clients are known to vary.
 */

function decodeOr(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHttp(topic: string): URL | null {
  let url: URL;
  try {
    url = new URL(topic);
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url : null;
}

/** The key subscriptions and announcements are matched on, or null for a
 * topic this hub can't serve. */
export function topicKey(topic: string): string | null {
  const url = parseHttp(topic);
  if (!url) return null;
  const path = url.pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeOr(segment)))
    .join("/");
  return `${decodeOr(url.username)}@${url.host}${path}${url.search}`;
}

export function topicHostname(topic: string): string | null {
  return parseHttp(topic)?.hostname ?? null;
}

/** `fetch` rejects URLs with credentials, so split them into a header. */
export function fetchTarget(topic: string): {
  url: string;
  authorization?: string;
} {
  const url = new URL(topic);
  const user = decodeOr(url.username);
  const pass = decodeOr(url.password);
  url.username = "";
  url.password = "";
  if (!user && !pass) return { url: url.toString() };
  return {
    url: url.toString(),
    authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
  };
}

export function redact(topic: string): string {
  const url = parseHttp(topic);
  if (!url || !url.password) return topic;
  url.password = "***";
  return url.toString();
}
```

- [ ] **Step 5: Run the topic tests to verify they pass**

Run: `cd feeds/hub && npx tsx topic.test.ts`
Expected: PASS, 6 tests. If `redact` prints `%2A%2A%2A`, change the expectation to what `URL` produces for `***` and keep that; the URL setter's encoding is what the logs will show.

- [ ] **Step 6: Write the failing store tests**

`feeds/hub/store.test.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SubscriptionStore } from "./store.ts";
import { topicKey } from "./topic.ts";

const TOPIC = "https://alice:pw@owntube.example/rss/queue/queue.audio.xml";
const KEY = topicKey(TOPIC) as string;

function fresh(): SubscriptionStore {
  return new SubscriptionStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "websub-store-")),
  );
}

function sub(overrides: Partial<Parameters<SubscriptionStore["upsert"]>[0]> = {}) {
  return {
    callback: "https://pc.example/websub/1",
    topic: TOPIC,
    secret: "s",
    leaseSeconds: 3600,
    expiresAt: 2000,
    ...overrides,
  };
}

test("upsert then active returns unexpired subscriptions for the key", () => {
  const store = fresh();
  store.upsert(sub());
  assert.equal(store.active(KEY, 1999).length, 1);
  assert.equal(store.active(KEY, 2000).length, 0);
});

test("resubscribing with a new password replaces the stored topic", () => {
  const store = fresh();
  store.upsert(sub());
  const changed = "https://alice:new@owntube.example/rss/queue/queue.audio.xml";
  store.upsert(sub({ topic: changed, expiresAt: 5000 }));
  const active = store.active(KEY, 1000);
  assert.equal(active.length, 1);
  assert.equal(active[0].topic, changed);
  assert.equal(active[0].expiresAt, 5000);
});

test("remove matches regardless of password", () => {
  const store = fresh();
  store.upsert(sub());
  assert.equal(
    store.remove(sub().callback, "https://alice:other@owntube.example/rss/queue/queue.audio.xml"),
    true,
  );
  assert.equal(store.active(KEY, 0).length, 0);
  assert.equal(store.remove(sub().callback, TOPIC), false);
});

test("pruneExpired deletes only expired rows", () => {
  const store = fresh();
  store.upsert(sub({ callback: "https://pc.example/a", expiresAt: 100 }));
  store.upsert(sub({ callback: "https://pc.example/b", expiresAt: 300 }));
  assert.equal(store.pruneExpired(200), 1);
  assert.deepEqual(
    store.active(KEY, 0).map((s) => s.callback),
    ["https://pc.example/b"],
  );
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd feeds/hub && npx tsx store.test.ts`
Expected: FAIL — `Cannot find module './store.ts'`.

- [ ] **Step 8: Implement `store.ts`**

`feeds/hub/store.ts`:

```ts
/**
 * SQLite store of verified subscriptions. One row per (callback, topic key):
 * resubscribing — including after a password change, which changes the topic
 * URL but not its key — refreshes the row instead of adding a second one.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { topicKey } from "./topic.ts";

export type Subscription = {
  callback: string;
  /** Topic URL exactly as the subscriber gave it, credentials included. */
  topic: string;
  secret: string | null;
  leaseSeconds: number;
  /** Unix seconds. */
  expiresAt: number;
};

type Row = {
  callback: string;
  topic: string;
  secret: string | null;
  lease_seconds: number;
  expires_at: number;
};

export class SubscriptionStore {
  private db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, "hub.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS subscriptions (
        callback TEXT NOT NULL,
        topic_key TEXT NOT NULL,
        topic TEXT NOT NULL,
        secret TEXT,
        lease_seconds INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (callback, topic_key)
      )`,
    );
  }

  upsert(sub: Subscription): void {
    const key = topicKey(sub.topic);
    if (!key) throw new Error("not an http(s) topic URL");
    this.db
      .prepare(
        `INSERT INTO subscriptions (callback, topic_key, topic, secret, lease_seconds, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(callback, topic_key) DO UPDATE SET
           topic = excluded.topic, secret = excluded.secret,
           lease_seconds = excluded.lease_seconds, expires_at = excluded.expires_at`,
      )
      .run(sub.callback, key, sub.topic, sub.secret, sub.leaseSeconds, sub.expiresAt);
  }

  remove(callback: string, topic: string): boolean {
    const key = topicKey(topic);
    if (!key) return false;
    return (
      this.db
        .prepare("DELETE FROM subscriptions WHERE callback = ? AND topic_key = ?")
        .run(callback, key).changes > 0
    );
  }

  active(key: string, now: number): Subscription[] {
    const rows = this.db
      .prepare(
        `SELECT callback, topic, secret, lease_seconds, expires_at
         FROM subscriptions WHERE topic_key = ? AND expires_at > ?`,
      )
      .all(key, now) as Row[];
    return rows.map((r) => ({
      callback: r.callback,
      topic: r.topic,
      secret: r.secret,
      leaseSeconds: r.lease_seconds,
      expiresAt: r.expires_at,
    }));
  }

  pruneExpired(now: number): number {
    return this.db
      .prepare("DELETE FROM subscriptions WHERE expires_at <= ?")
      .run(now).changes;
  }
}
```

- [ ] **Step 9: Run both test files to verify they pass**

Run: `cd feeds/hub && npx tsx topic.test.ts && npx tsx store.test.ts`
Expected: PASS, 6 + 4 tests.

- [ ] **Step 10: Commit**

```bash
git add feeds/hub/package.json feeds/hub/package-lock.json feeds/hub/tsconfig.json feeds/hub/topic.ts feeds/hub/topic.test.ts feeds/hub/store.ts feeds/hub/store.test.ts
git commit -m "WebSub hub: topic matching and subscription store"
```

---

### Task 2: Callback address safety

**Files:**
- Create: `feeds/hub/safety.ts`, `feeds/hub/safety.test.ts`

**Interfaces:**
- Produces:
  - `isPublicAddress(ip: string): boolean`
  - `callbackIsPublic(callback: string, lookup?: (host: string) => Promise<string[]>): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

`feeds/hub/safety.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd feeds/hub && npx tsx safety.test.ts`
Expected: FAIL — `Cannot find module './safety.ts'`.

- [ ] **Step 3: Implement `safety.ts`**

`feeds/hub/safety.ts`:

```ts
/**
 * The hub makes outbound requests to whatever callback a subscriber names.
 * It runs on spiff next to other services, so a callback must resolve only to
 * public addresses — otherwise anyone could make the hub probe the host's
 * private networks. Checked at subscribe time and again before each delivery
 * (DNS can change in between).
 */
import { promises as dns } from "node:dns";
import net from "node:net";

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return false;
  // An IPv4-mapped IPv6 address reaches the IPv4 host, so judge that.
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return !blocked.check(mapped[1], "ipv4");
  return !blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}

async function lookupAll(host: string): Promise<string[]> {
  const records = await dns.lookup(host, { all: true });
  return records.map((r) => r.address);
}

export async function callbackIsPublic(
  callback: string,
  lookup: (host: string) => Promise<string[]> = lookupAll,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(callback);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [host]
    : await lookup(host).catch(() => [] as string[]);
  return addresses.length > 0 && addresses.every(isPublicAddress);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd feeds/hub && npx tsx safety.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add feeds/hub/safety.ts feeds/hub/safety.test.ts
git commit -m "WebSub hub: refuse callbacks on private addresses"
```

---

### Task 3: Hub protocol — subscribe, unsubscribe, publish, deliver

**Files:**
- Create: `feeds/hub/hub.ts`, `feeds/hub/hub.test.ts`

**Interfaces:**
- Consumes: `SubscriptionStore`, `Subscription`, `topicKey`, `topicHostname`, `fetchTarget`, `redact` (Task 1).
- Produces:
  - `type HubResult = { status: number; body: string; after?: () => Promise<void> }` — `after` is the work to run once the response is sent (verification or delivery); tests await it.
  - `type HubOptions = { store: SubscriptionStore; hubUrl: string; publishToken: string; topicHosts: string[]; isCallbackAllowed: (callback: string) => Promise<boolean>; fetch?: typeof fetch; now?: () => number; log?: (msg: string) => void; retryDelaysMs?: number[] }`
  - `class Hub { constructor(opts: HubOptions); handle(form: URLSearchParams, authorization?: string): Promise<HubResult> }`
  - Constants `DEFAULT_LEASE_SECONDS = 864000`, `MIN_LEASE_SECONDS = 3600`, `MAX_LEASE_SECONDS = 2592000`.

- [ ] **Step 1: Write the failing tests**

`feeds/hub/hub.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd feeds/hub && npx tsx hub.test.ts`
Expected: FAIL — `Cannot find module './hub.ts'`.

- [ ] **Step 3: Implement `hub.ts`**

`feeds/hub/hub.ts`:

```ts
/**
 * A minimal WebSub hub (https://www.w3.org/TR/websub/).
 *
 * Subscribers (Pocket Casts' servers) POST hub.mode=subscribe|unsubscribe;
 * intent is verified by calling the callback back with a challenge before
 * anything is stored. The publisher (the OwnTube feeds server) POSTs
 * hub.mode=publish with a bearer token and one hub.url per changed feed; the
 * hub then fetches each matching subscription's topic — with that
 * subscription's own credentials, since feeds are per user — and delivers the
 * body to its callback, signed when the subscriber supplied a secret.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Subscription, SubscriptionStore } from "./store.ts";
import { fetchTarget, redact, topicHostname, topicKey } from "./topic.ts";

export const DEFAULT_LEASE_SECONDS = 10 * 86400;
export const MIN_LEASE_SECONDS = 3600;
export const MAX_LEASE_SECONDS = 30 * 86400;

export type HubResult = {
  status: number;
  body: string;
  /** Work to run after the response is sent (verification or delivery). */
  after?: () => Promise<void>;
};

export type HubOptions = {
  store: SubscriptionStore;
  /** This hub's public URL, sent back in delivery Link headers. */
  hubUrl: string;
  publishToken: string;
  /** Hostnames whose topics this hub serves. */
  topicHosts: string[];
  isCallbackAllowed: (callback: string) => Promise<boolean>;
  fetch?: typeof fetch;
  /** Unix seconds. */
  now?: () => number;
  log?: (msg: string) => void;
  /** Waits between delivery attempts; one retry per entry. */
  retryDelaysMs?: number[];
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bearerMatches(header: string | undefined, token: string): boolean {
  const m = (header ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const given = Buffer.from(m[1]);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Hub {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly retryDelaysMs: number[];

  constructor(private readonly opts: HubOptions) {
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.log = opts.log ?? (() => {});
    this.retryDelaysMs = opts.retryDelaysMs ?? [5_000, 30_000, 120_000];
  }

  async handle(form: URLSearchParams, authorization?: string): Promise<HubResult> {
    const mode = form.get("hub.mode");
    if (mode === "subscribe" || mode === "unsubscribe") {
      return this.handleSubscription(mode, form);
    }
    if (mode === "publish") return this.handlePublish(form, authorization);
    return { status: 400, body: "hub.mode must be subscribe, unsubscribe or publish\n" };
  }

  private async handleSubscription(
    mode: "subscribe" | "unsubscribe",
    form: URLSearchParams,
  ): Promise<HubResult> {
    const callback = form.get("hub.callback") ?? "";
    const topic = form.get("hub.topic") ?? "";
    const host = topicHostname(topic);
    if (!host || !topicKey(topic)) {
      return { status: 400, body: "hub.topic must be an http(s) URL\n" };
    }
    if (!this.opts.topicHosts.includes(host)) {
      return { status: 400, body: "topic not served by this hub\n" };
    }
    if (!(await this.opts.isCallbackAllowed(callback))) {
      return { status: 400, body: "hub.callback must be a public http(s) URL\n" };
    }
    const secret = form.get("hub.secret");
    if (secret !== null && Buffer.byteLength(secret) >= 200) {
      return { status: 400, body: "hub.secret must be under 200 bytes\n" };
    }
    const requested = Number.parseInt(form.get("hub.lease_seconds") ?? "", 10);
    const lease = Number.isFinite(requested)
      ? Math.min(MAX_LEASE_SECONDS, Math.max(MIN_LEASE_SECONDS, requested))
      : DEFAULT_LEASE_SECONDS;
    return {
      status: 202,
      body: "accepted\n",
      after: () => this.verifyIntent(mode, callback, topic, secret || null, lease),
    };
  }

  private async verifyIntent(
    mode: "subscribe" | "unsubscribe",
    callback: string,
    topic: string,
    secret: string | null,
    lease: number,
  ): Promise<void> {
    const challenge = randomBytes(16).toString("hex");
    const url = new URL(callback);
    url.searchParams.set("hub.mode", mode);
    url.searchParams.set("hub.topic", topic);
    url.searchParams.set("hub.challenge", challenge);
    if (mode === "subscribe") url.searchParams.set("hub.lease_seconds", String(lease));
    let confirmed = false;
    try {
      const res = await this.fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      confirmed = res.ok && (await res.text()).trim() === challenge;
    } catch (error) {
      this.log(`${mode} verification failed for ${callback}: ${message(error)}`);
    }
    if (!confirmed) {
      this.log(`${mode} NOT confirmed: ${callback} → ${redact(topic)}`);
      return;
    }
    if (mode === "subscribe") {
      this.opts.store.upsert({
        callback,
        topic,
        secret,
        leaseSeconds: lease,
        expiresAt: this.now() + lease,
      });
    } else {
      this.opts.store.remove(callback, topic);
    }
    this.log(`${mode} confirmed: ${callback} → ${redact(topic)}`);
  }

  private handlePublish(form: URLSearchParams, authorization?: string): HubResult {
    if (!bearerMatches(authorization, this.opts.publishToken)) {
      return { status: 401, body: "unauthorized\n" };
    }
    const urls = [...form.getAll("hub.url"), ...form.getAll("hub.topic")];
    const keys = urls.map(topicKey);
    if (urls.length === 0 || keys.some((k) => k === null)) {
      return { status: 400, body: "hub.url must be one or more http(s) URLs\n" };
    }
    return {
      status: 202,
      body: "accepted\n",
      after: async () => {
        this.opts.store.pruneExpired(this.now());
        await Promise.all((keys as string[]).map((k) => this.distribute(k)));
      },
    };
  }

  private async distribute(key: string): Promise<void> {
    const subs = this.opts.store.active(key, this.now());
    await Promise.all(subs.map((s) => this.deliver(s)));
  }

  private async deliver(sub: Subscription): Promise<void> {
    if (!(await this.opts.isCallbackAllowed(sub.callback))) {
      this.log(`skip ${sub.callback}: no longer a public address`);
      return;
    }
    const target = fetchTarget(sub.topic);
    let body: Buffer;
    let contentType: string;
    try {
      const res = await this.fetch(target.url, {
        headers: target.authorization ? { authorization: target.authorization } : {},
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        this.log(`fetch ${redact(sub.topic)} → ${res.status}; not delivered`);
        return;
      }
      body = Buffer.from(await res.arrayBuffer());
      contentType = res.headers.get("content-type") ?? "application/rss+xml";
    } catch (error) {
      this.log(`fetch ${redact(sub.topic)} failed: ${message(error)}`);
      return;
    }
    const headers: Record<string, string> = {
      "content-type": contentType,
      link: `<${this.opts.hubUrl}>; rel="hub", <${sub.topic}>; rel="self"`,
    };
    if (sub.secret) {
      headers["x-hub-signature"] =
        `sha256=${createHmac("sha256", sub.secret).update(body).digest("hex")}`;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.fetch(sub.callback, {
          method: "POST",
          headers,
          body,
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 410) {
          this.opts.store.remove(sub.callback, sub.topic);
          this.log(`${sub.callback} is gone; unsubscribed`);
          return;
        }
        if (res.ok) {
          this.log(`delivered ${redact(sub.topic)} → ${sub.callback}`);
          return;
        }
        this.log(`deliver to ${sub.callback} → ${res.status}`);
      } catch (error) {
        this.log(`deliver to ${sub.callback} failed: ${message(error)}`);
      }
      if (attempt >= this.retryDelaysMs.length) {
        this.log(`giving up on ${sub.callback} for ${redact(sub.topic)}`);
        return;
      }
      await sleep(this.retryDelaysMs[attempt]);
    }
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd feeds/hub && npx tsx hub.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add feeds/hub/hub.ts feeds/hub/hub.test.ts
git commit -m "WebSub hub: verified subscriptions and signed per-user delivery"
```

---

### Task 4: Hub HTTP server and packaging

**Files:**
- Create: `feeds/hub/server.ts`, `feeds/hub/Dockerfile`, `feeds/hub/docker-compose.yml`, `feeds/hub/README.md`
- Modify: `feeds/README.md` (diagram and a `hub/` paragraph)

**Interfaces:**
- Consumes: `Hub`, `SubscriptionStore`, `callbackIsPublic`.
- Produces: HTTP `POST /` (form-encoded WebSub requests), `GET /health`, `GET /` (one-line description). Container `websub-hub` on the `caddy` network, port 8080.

- [ ] **Step 1: Implement `server.ts`**

`feeds/hub/server.ts`:

```ts
/**
 * WebSub hub for OwnTube's podcast feeds — websub.nedworks.org.
 *
 *   POST /        WebSub requests (application/x-www-form-urlencoded):
 *                 hub.mode=subscribe|unsubscribe (anyone; intent-verified)
 *                 hub.mode=publish (Bearer HUB_PUBLISH_TOKEN)
 *   GET  /health  liveness
 */
import http from "node:http";
import { Hub } from "./hub.ts";
import { callbackIsPublic } from "./safety.ts";
import { SubscriptionStore } from "./store.ts";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const HUB_URL = process.env.HUB_URL?.trim() ?? "";
const PUBLISH_TOKEN = process.env.HUB_PUBLISH_TOKEN?.trim() ?? "";
const TOPIC_HOSTS = (process.env.HUB_TOPIC_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const MAX_BODY_BYTES = 64 * 1024;

function logLine(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

if (!HUB_URL || !PUBLISH_TOKEN || TOPIC_HOSTS.length === 0) {
  process.stderr.write(
    "websub-hub: HUB_URL, HUB_PUBLISH_TOKEN and HUB_TOPIC_HOSTS must be set\n",
  );
  process.exit(1);
}

const store = new SubscriptionStore(DATA_DIR);
const hub = new Hub({
  store,
  hubUrl: HUB_URL,
  publishToken: PUBLISH_TOKEN,
  topicHosts: TOPIC_HOSTS,
  isCallbackAllowed: (callback) => callbackIsPublic(callback),
  log: logLine,
});

setInterval(() => {
  const pruned = store.pruneExpired(Math.floor(Date.now() / 1000));
  if (pruned > 0) logLine(`pruned ${pruned} expired subscription(s)`);
}, 3_600_000).unref();

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer((req, res) => {
  void (async () => {
    const method = req.method ?? "GET";
    const pathname = (req.url ?? "/").split("?")[0];
    if (method === "GET" && pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
      return;
    }
    if (method === "GET" && pathname === "/") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("WebSub hub (https://www.w3.org/TR/websub/). POST hub.mode=subscribe here.\n");
      return;
    }
    if (method === "POST" && pathname === "/") {
      const form = new URLSearchParams(await readBody(req));
      const result = await hub.handle(form, req.headers.authorization);
      res.writeHead(result.status, { "content-type": "text/plain" });
      res.end(result.body);
      if (result.after) {
        result.after().catch((error: unknown) => {
          logLine(`background work failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found\n");
  })().catch((error: unknown) => {
    process.stderr.write(
      `websub-hub request failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("internal error\n");
  });
});

server.listen(PORT, () => {
  logLine(`websub-hub listening on :${PORT} as ${HUB_URL} (topics: ${TOPIC_HOSTS.join(", ")})`);
});
```

- [ ] **Step 2: Smoke-test it locally**

Run:
```bash
cd feeds/hub && (HUB_URL=http://localhost:8099/ HUB_PUBLISH_TOKEN=t HUB_TOPIC_HOSTS=owntube.nedworks.org DATA_DIR=$(mktemp -d) PORT=8099 npx tsx server.ts & echo $! > /tmp/hub.pid); sleep 2
curl -s localhost:8099/health
curl -s -o /dev/null -w '%{http_code}\n' -d 'hub.mode=publish&hub.url=https://a@owntube.nedworks.org/rss/q.xml' localhost:8099/
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer t' -d 'hub.mode=publish&hub.url=https://a@owntube.nedworks.org/rss/q.xml' localhost:8099/
curl -s -d 'hub.mode=subscribe&hub.callback=http://10.0.0.1/cb&hub.topic=https://a:b@owntube.nedworks.org/rss/q.xml' localhost:8099/
kill $(cat /tmp/hub.pid)
```
Expected: `ok`, `401`, `202`, `hub.callback must be a public http(s) URL`.

- [ ] **Step 3: Add the Dockerfile and compose file**

`feeds/hub/Dockerfile`:

```dockerfile
# Debian-slim (glibc) so better-sqlite3 uses its prebuilt binary — no toolchain.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY tsconfig.json server.ts hub.ts store.ts topic.ts safety.ts ./

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

EXPOSE 8080
VOLUME ["/data"]

CMD ["npx", "tsx", "server.ts"]
```

`feeds/hub/docker-compose.yml`:

```yaml
# Deploy on spiff, publishing websub.nedworks.org. Same caddy-docker-proxy
# label style as feeds/server. The feeds server reaches this container over the
# shared `caddy` network as http://websub-hub:8080/ to announce changes.
services:
  websub-hub:
    container_name: websub-hub
    hostname: websub-hub
    build:
      context: .
    restart: unless-stopped
    environment:
      PORT: "8080"
      DATA_DIR: /data
      HUB_URL: https://websub.nedworks.org/
      HUB_TOPIC_HOSTS: ${HUB_TOPIC_HOSTS:-owntube.nedworks.org}
      HUB_PUBLISH_TOKEN: ${HUB_PUBLISH_TOKEN:?set HUB_PUBLISH_TOKEN in .env}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 10s
    volumes:
      - ./data:/data
    networks:
      - caddy
    labels:
      caddy: "websub.nedworks.org"
      caddy.reverse_proxy: "* {{upstreams 8080}}"

networks:
  caddy:
    external: true
```

Run: `cd feeds/hub && docker build -t websub-hub-test . && docker rmi websub-hub-test`
Expected: builds successfully.

- [ ] **Step 4: Document it**

`feeds/hub/README.md`:

```markdown
# WebSub hub

A minimal [WebSub](https://www.w3.org/TR/websub/) hub at
`https://websub.nedworks.org/`. OwnTube's feeds advertise it with
`<atom:link rel="hub">`; podcast platforms (Pocket Casts) subscribe to it and
get new feed content pushed within seconds of a change instead of polling.

- **Subscribe/unsubscribe** — anyone may ask; every request is confirmed by
  calling the callback back with a challenge. Callbacks must resolve to public
  addresses. Topics must be on a host listed in `HUB_TOPIC_HOSTS`.
- **Publish** — only the feeds server, with `Authorization: Bearer
  $HUB_PUBLISH_TOKEN`, one `hub.url` per changed feed.
- **Per-user topics** — topic URLs carry the feed's credentials
  (`https://user:pass@owntube.nedworks.org/rss/...`). The hub fetches each
  subscription's topic with its own credentials, and matches announcements
  (`https://user@...`, no password) on username + URL.

| Variable | Purpose |
|---|---|
| `HUB_URL` | This hub's public URL |
| `HUB_TOPIC_HOSTS` | Comma-separated hostnames whose feeds this hub serves |
| `HUB_PUBLISH_TOKEN` | Bearer token the feeds server announces with |
| `DATA_DIR` | SQLite location (`hub.db`) |

Tests: `npm test`. Deploy: `docker compose up -d --build` on spiff with
`HUB_PUBLISH_TOKEN` in `.env`.
```

In `feeds/README.md`, replace the diagram and the `pusher/` paragraph with:

````markdown
```
web app (home) ──POST /publish (Bearer)──▶ server (public: owntube.nedworks.org)
                                               │  ├── /<feed>.rss        Basic Auth, per user
                                               │  ├── /chapters/<id>.json public
                                               │  └── /icon.png          public (cover art)
                                               │
                                               └─hub.mode=publish──▶ hub (public: websub.nedworks.org)
                                                                        └──▶ subscribers (Pocket Casts)
```

**Publishing** happens inside the web app (`apps/web/src/server/remote/publish-loop.ts`,
started from `instrumentation.ts` when `OWNTUBE_PUBLISH_TARGET` is set): it
builds every user's feed snapshots from the app's database and POSTs them to
the server shortly after anything a feed is built from changes, and at least
every `OWNTUBE_PUBLISH_INTERVAL_SEC`.

**`hub/`** is a WebSub hub. The server announces the feeds whose content
changed; the hub pushes them to subscribed podcast platforms. See `hub/README.md`.
````

- [ ] **Step 5: Commit**

```bash
git add feeds/hub/server.ts feeds/hub/Dockerfile feeds/hub/docker-compose.yml feeds/hub/README.md feeds/README.md
git commit -m "WebSub hub: HTTP server and spiff deployment"
```

---

### Task 5: Feeds server — advertise the hub and announce changed feeds

**Files:**
- Modify: `feeds/server/store.ts` (`replaceAll` returns changed feeds)
- Modify: `feeds/server/store.test.ts`
- Modify: `feeds/server/render.ts` (`RenderOptions.hubUrl`)
- Modify: `feeds/server/render.test.ts`
- Create: `feeds/server/notify-hub.ts`, `feeds/server/notify-hub.test.ts`
- Modify: `feeds/server/server.ts`, `feeds/server/package.json` (test script), `feeds/server/Dockerfile` (copy `notify-hub.ts`), `feeds/server/docker-compose.yml` (env)

**Interfaces:**
- Consumes: the hub's publish contract from Task 3 (`hub.mode=publish`, repeated `hub.url`, Bearer token; topic URLs `https://<encoded user>@<host>/rss/<kind>/<slug>.<audio|video>.xml`).
- Produces:
  - `FeedStore.replaceAll(feeds, users): { upserted: number; changed: FeedKey[] }` with `type FeedKey = { owner: string; kind: string; slug: string }`.
  - `feedTopicUrl(publicUrl: string, owner: string, pathname: string, password?: string): string`
  - `hubTopicUrls(publicUrl: string, feed: FeedKey): string[]`
  - `notifyHub(config: HubConfig, feeds: FeedKey[], fetchImpl?: typeof fetch): Promise<void>` with `type HubConfig = { publicUrl: string; publishUrl: string; token: string }`.
  - `RenderOptions.hubUrl?: string`.

- [ ] **Step 1: Write the failing store test**

Append to `feeds/server/store.test.ts`:

```ts
test("replaceAll reports feeds whose content changed, ignoring updatedAt", () => {
  const { store } = freshStore();
  const users = [{ username: "alice", passSha256: "a".repeat(64) }];
  const queue = snap("alice", "queue", "queue");
  const tech = snap("alice", "playlist", "tech");

  assert.deepEqual(store.replaceAll([queue, tech], users).changed, [
    { owner: "alice", kind: "queue", slug: "queue" },
    { owner: "alice", kind: "playlist", slug: "tech" },
  ]);

  const rebuilt = [
    { ...queue, updatedAt: queue.updatedAt + 60 },
    { ...tech, updatedAt: tech.updatedAt + 60 },
  ];
  assert.deepEqual(store.replaceAll(rebuilt, users).changed, []);

  const newEpisode = {
    ...tech,
    items: [
      {
        videoId: "abc123XYZ_-",
        title: "New",
        enclosureAudio: "https://m/a.m4a",
        enclosureVideo: "https://m/a.mp4",
      },
    ],
  };
  assert.deepEqual(store.replaceAll([queue, newEpisode], users).changed, [
    { owner: "alice", kind: "playlist", slug: "tech" },
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd feeds/server && npx tsx store.test.ts`
Expected: FAIL — `changed` is `undefined`.

- [ ] **Step 3: Implement change reporting in `store.ts`**

Add below the `UserCredential` type:

```ts
export type FeedKey = { owner: string; kind: string; slug: string };

/** A snapshot's content for change detection. Most feeds are rebuilt with
 * updatedAt = now on every publish, so it can't count as a change. */
function contentOf(feed: FeedSnapshot): string {
  return JSON.stringify({ ...feed, updatedAt: 0 });
}
```

Change the `replaceAll` signature and body:

```ts
  /** Replace the entire published set (feeds and users), atomically. Returns
   * the feeds that are new or whose content changed. */
  replaceAll(
    feeds: FeedSnapshot[],
    users: UserCredential[],
  ): { upserted: number; changed: FeedKey[] } {
```

Inside, before `const tx = ...`, add:

```ts
    const readJson = this.db.prepare(
      "SELECT json FROM feeds WHERE owner = ? AND kind = ? AND slug = ?",
    );
    const changed: FeedKey[] = [];
```

At the top of the `for (const f of rows)` loop in the transaction, before `upsert.run(...)`:

```ts
          const prev = readJson.get(f.owner, f.kind, f.slug) as
            | { json: string }
            | undefined;
          let same = false;
          if (prev) {
            try {
              same = contentOf(JSON.parse(prev.json) as FeedSnapshot) === contentOf(f);
            } catch {
              /* unreadable stored row — treat as changed */
            }
          }
          if (!same) changed.push({ owner: f.owner, kind: f.kind, slug: f.slug });
```

And change the return to `return { upserted: feeds.length, changed };`.

- [ ] **Step 4: Run the store tests to verify they pass**

Run: `cd feeds/server && npx tsx store.test.ts`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Write the failing render and notify tests**

Append to `feeds/server/render.test.ts`:

```ts
test("hub link is advertised when configured; credentials stay out of derived URLs", () => {
  const xml = renderRss(sample, "audio", {
    selfUrl: "https://alice:pw@pub.example/rss/playlist/cooking.audio.xml",
    hubUrl: "https://websub.example/",
  });
  assert.match(xml, /<atom:link href="https:\/\/websub\.example\/" rel="hub"\/>/);
  assert.match(
    xml,
    /<atom:link href="https:\/\/alice:pw@pub\.example\/rss\/playlist\/cooking\.audio\.xml" rel="self"/,
  );
  assert.match(xml, /<itunes:image href="https:\/\/pub\.example\/icon\.png"\/>/);
  assert.doesNotMatch(renderRss(sample, "audio"), /rel="hub"/);
});
```

If `sample` sets its own `image`, change the `itunes:image` assertion to check that no `alice:pw@` appears in any `href` other than the self link: `assert.equal((xml.match(/alice:pw@/g) ?? []).length, 1);`.

`feeds/server/notify-hub.test.ts`:

```ts
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
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd feeds/server && npx tsx render.test.ts; npx tsx notify-hub.test.ts`
Expected: render test FAILS (no `rel="hub"`); notify test FAILS with `Cannot find module './notify-hub.ts'`.

- [ ] **Step 7: Implement the hub link and `notify-hub.ts`**

In `feeds/server/render.ts`, extend `RenderOptions`:

```ts
export type RenderOptions = {
  /** Absolute URL this feed is served at (for `<atom:link rel="self">`). */
  selfUrl?: string;
  /** WebSub hub to advertise (`<atom:link rel="hub">`). */
  hubUrl?: string;
  author?: string;
};
```

And directly after the `if (options.selfUrl) { head.push(...rel="self"...) }` block:

```ts
  if (options.hubUrl) {
    head.push(`    <atom:link href="${xmlEscape(options.hubUrl)}" rel="hub"/>`);
  }
```

(`publicBase` already uses `new URL(selfUrl).origin`, which excludes credentials, so chapter and icon URLs stay credential-free.)

`feeds/server/notify-hub.ts`:

```ts
/**
 * WebSub announcements. Feeds are per user and share paths, so a feed's topic
 * URL carries its owner's username (and, in the feed's own self link, the
 * password the client authenticated with). The hub matches announcements on
 * username + URL and fetches each subscription with the credentials it
 * subscribed with — this server never needs the plaintext password.
 */
import type { FeedKey } from "./store.ts";

export type HubConfig = {
  /** Public origin of this server, e.g. https://owntube.nedworks.org */
  publicUrl: string;
  /** Where to POST announcements (the hub, possibly its internal address). */
  publishUrl: string;
  token: string;
};

export function feedTopicUrl(
  publicUrl: string,
  owner: string,
  pathname: string,
  password?: string,
): string {
  const base = new URL(publicUrl);
  const userinfo =
    password === undefined
      ? encodeURIComponent(owner)
      : `${encodeURIComponent(owner)}:${encodeURIComponent(password)}`;
  return `${base.protocol}//${userinfo}@${base.host}${pathname}`;
}

export function hubTopicUrls(publicUrl: string, feed: FeedKey): string[] {
  return (["audio", "video"] as const).map((variant) =>
    feedTopicUrl(
      publicUrl,
      feed.owner,
      `/rss/${encodeURIComponent(feed.kind)}/${encodeURIComponent(feed.slug)}.${variant}.xml`,
    ),
  );
}

export async function notifyHub(
  config: HubConfig,
  feeds: FeedKey[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (feeds.length === 0) return;
  const body = new URLSearchParams({ "hub.mode": "publish" });
  for (const feed of feeds) {
    for (const url of hubTopicUrls(config.publicUrl, feed)) body.append("hub.url", url);
  }
  const res = await fetchImpl(config.publishUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Bearer ${config.token}`,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`hub ${res.status}`);
}
```

The paths must stay identical to `feedUrl()` in `server.ts` (`/rss/${encodeURIComponent(kind)}/${encodeURIComponent(slug)}.${variant}.xml`).

- [ ] **Step 8: Run them to verify they pass**

Run: `cd feeds/server && npx tsx render.test.ts && npx tsx notify-hub.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire it into `server.ts`**

Add the import: `import { type HubConfig, feedTopicUrl, notifyHub } from "./notify-hub.ts";`

After the `IP_ALLOWLIST_ON` constant:

```ts
// WebSub: on only when all three are set. HUB_URL is advertised in every feed;
// HUB_PUBLISH_URL is where announcements go (the hub's internal address on the
// shared Docker network, defaulting to HUB_URL).
const HUB_URL = process.env.HUB_URL?.trim() ?? "";
const HUB_PUBLISH_TOKEN = process.env.HUB_PUBLISH_TOKEN?.trim() ?? "";
const PUBLIC_URL = process.env.PUBLIC_URL?.trim() ?? "";
const hub: HubConfig | null =
  HUB_URL && HUB_PUBLISH_TOKEN && PUBLIC_URL
    ? {
        publicUrl: PUBLIC_URL,
        publishUrl: process.env.HUB_PUBLISH_URL?.trim() || HUB_URL,
        token: HUB_PUBLISH_TOKEN,
      }
    : null;
if (HUB_URL && !hub) {
  process.stderr.write("feeds-server: HUB_URL needs HUB_PUBLISH_TOKEN and PUBLIC_URL\n");
  process.exit(1);
}
```

Change `checkBasicAuth` to return the password as well — its return type becomes `{ owner: string; password: string } | null`, and its last line becomes:

```ts
  return ok && user ? { owner: user.username, password: pass } : null;
```

Update its doc comment's first line to "The authenticated owner and the password they used, or null." In the request handler, replace

```ts
      const owner = checkBasicAuth(req);
      if (!owner) {
```

with

```ts
      const auth = checkBasicAuth(req);
      if (!auth) {
        requireBasicAuth(res);
        return;
      }
      const { owner } = auth;
```

(removing the old `requireBasicAuth(res); return; }` lines that followed), and replace the RSS render call with:

```ts
        // With a hub, the self link is the exact credentialed URL: it is the
        // WebSub topic, unique per user, and the hub fetches it as-is.
        const self = hub
          ? feedTopicUrl(hub.publicUrl, owner, pathname, auth.password)
          : selfUrl(req);
        sendXml(
          res,
          renderRss(feed, rss.variant, {
            selfUrl: self,
            hubUrl: hub ? HUB_URL : undefined,
          }),
        );
```

In `handlePublish`, change `const { upserted } = store.replaceAll(` to `const { upserted, changed } = store.replaceAll(`, and after `res.end(JSON.stringify({ ok: true, feeds: upserted, items }));` add:

```ts
  // Announce after responding: a hub outage must never fail a publish.
  if (hub && changed.length > 0) {
    notifyHub(hub, changed).then(
      () => logLine(`hub notified: ${changed.length} changed feed(s)`),
      (error: unknown) =>
        logLine(`hub notify failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
```

In `server.listen`'s callback add: `logLine(hub ? \`feeds-server: WebSub hub ${HUB_URL}\` : "feeds-server: WebSub off");`

- [ ] **Step 10: Update packaging**

- `feeds/server/package.json` test script: `"tsx render.test.ts && tsx ip-allow.test.ts && tsx store.test.ts && tsx notify-hub.test.ts"`.
- `feeds/server/Dockerfile`: `COPY tsconfig.json server.ts store.ts render.ts ip-allow.ts notify-hub.ts icon.png ./`
- `feeds/server/docker-compose.yml`, under `environment:` after `PUBLISH_ALLOW_IPS`:

```yaml
      # WebSub (optional; on when all three are set). See ../hub/README.md.
      HUB_URL: ${HUB_URL:-}
      HUB_PUBLISH_URL: ${HUB_PUBLISH_URL:-}
      HUB_PUBLISH_TOKEN: ${HUB_PUBLISH_TOKEN:-}
      PUBLIC_URL: ${PUBLIC_URL:-}
```

- [ ] **Step 11: Run the whole feeds server suite and a typecheck**

Run: `cd feeds/server && npm test && npx tsc -p .`
Expected: all tests PASS; `tsc` reports no errors.

- [ ] **Step 12: Commit**

```bash
git add feeds/server
git commit -m "Feeds server: advertise the WebSub hub and announce changed feeds"
```

---

### Task 6: In-app feed publisher

**Files:**
- Create: `apps/web/src/server/remote/publish-loop.ts`, `apps/web/src/server/remote/publish-loop.test.ts`
- Modify: `apps/web/src/instrumentation.ts`

**Interfaces:**
- Consumes: `publishFeeds(db, { target, secret, appOrigin, onLog })` from `@/server/remote/publish`; `replayRecentHistory(db, { onLog })` from `@/server/hooks/replay-history`; `getDb()` from `@/server/db/client`; table `feed_publish_state (id = 1, dirty_at, published_at)`.
- Produces:
  - `publishReason(state: PublishState, now: number, timing: PublishTiming): "changed" | "interval" | null`
  - `createFeedPublisher(deps: FeedPublisherDeps): { tick: () => Promise<void> }`
  - `startFeedPublisher(): boolean` — `true` if started, `false` when not configured or already running.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/server/remote/publish-loop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createFeedPublisher,
  DEFAULT_TIMING,
  type PublishState,
  publishReason,
} from "./publish-loop";

const T = DEFAULT_TIMING; // quiet 30, maxWait 120, interval 1800

describe("publishReason", () => {
  it("waits for writes to go quiet", () => {
    expect(publishReason({ dirtyAt: 1000, publishedAt: 990 }, 1010, T)).toBeNull();
    expect(publishReason({ dirtyAt: 1000, publishedAt: 990 }, 1030, T)).toBe("changed");
  });

  it("publishes mid-burst once maxWait has passed since the last publish", () => {
    expect(publishReason({ dirtyAt: 1119, publishedAt: 1000 }, 1120, T)).toBe("changed");
  });

  it("republishes on the interval without changes", () => {
    expect(publishReason({ dirtyAt: 0, publishedAt: 1000 }, 2799, T)).toBeNull();
    expect(publishReason({ dirtyAt: 0, publishedAt: 1000 }, 2800, T)).toBe("interval");
  });
});

function harness(initial: PublishState) {
  const state = { ...initial };
  let clock = 10_000;
  const calls = { publish: 0, replay: 0, logs: [] as string[] };
  let failPublish = false;
  const publisher = createFeedPublisher({
    readState: () => ({ ...state }),
    markPublished: (at) => {
      state.publishedAt = at;
    },
    publish: async () => {
      calls.publish++;
      if (failPublish) throw new Error("feeds server unreachable");
      return { feedCount: 3, itemCount: 12 };
    },
    replay: async () => {
      calls.replay++;
    },
    now: () => clock,
    log: (m) => calls.logs.push(m),
  });
  return {
    state,
    calls,
    publisher,
    advance: (s: number) => {
      clock += s;
    },
    now: () => clock,
    setFail: (v: boolean) => {
      failPublish = v;
    },
  };
}

describe("createFeedPublisher", () => {
  it("publishes a quiet change once and stamps one second before the run began", async () => {
    const h = harness({ dirtyAt: 9_960, publishedAt: 9_000 });
    await h.publisher.tick();
    expect(h.calls.publish).toBe(1);
    expect(h.state.publishedAt).toBe(9_999);
    h.advance(10);
    await h.publisher.tick();
    expect(h.calls.publish).toBe(1);
  });

  it("republishes a write that landed in the same second the publish started", async () => {
    const h = harness({ dirtyAt: 9_960, publishedAt: 9_000 });
    await h.publisher.tick();
    h.state.dirtyAt = 10_000;
    h.advance(30);
    await h.publisher.tick();
    expect(h.calls.publish).toBe(2);
  });

  it("does not mark a failed publish and backs off for a minute", async () => {
    const h = harness({ dirtyAt: 9_960, publishedAt: 9_000 });
    h.setFail(true);
    await h.publisher.tick();
    expect(h.state.publishedAt).toBe(9_000);
    h.setFail(false);
    h.advance(50);
    await h.publisher.tick();
    expect(h.calls.publish).toBe(1);
    h.advance(10);
    await h.publisher.tick();
    expect(h.calls.publish).toBe(2);
    expect(h.state.publishedAt).toBe(10_059);
  });

  it("replays history at start and then once per interval, however often it publishes", async () => {
    const h = harness({ dirtyAt: 0, publishedAt: 10_000 });
    await h.publisher.tick();
    expect(h.calls.replay).toBe(1);
    h.advance(1_799);
    await h.publisher.tick();
    expect(h.calls.replay).toBe(1);
    h.advance(1);
    await h.publisher.tick();
    expect(h.calls.replay).toBe(2);
  });

  it("skips a tick while the previous one is still running", async () => {
    const h = harness({ dirtyAt: 9_960, publishedAt: 9_000 });
    await Promise.all([h.publisher.tick(), h.publisher.tick()]);
    expect(h.calls.publish).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run src/server/remote/publish-loop.test.ts`
Expected: FAIL — cannot resolve `./publish-loop`.

- [ ] **Step 3: Implement `publish-loop.ts`**

`apps/web/src/server/remote/publish-loop.ts`:

```ts
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { replayRecentHistory } from "@/server/hooks/replay-history";
import { publishFeeds } from "@/server/remote/publish";

/**
 * Feed publisher, running inside the web app (it replaced the separate
 * feeds-pusher container). SQLite triggers stamp feed_publish_state.dirty_at
 * on every write to a table a feed is built from — including writes made by
 * other processes on the same database — so polling that one row is all the
 * change detection needed. The public feeds server works out which feeds
 * actually changed and announces those to the WebSub hub.
 *
 * It also runs the watch-history replay on the slow interval: re-firing the
 * last 48h through the hooks is what heals OwnTube → Pocket Casts after an
 * outage (pocket-sessions' own replay only covers the other direction).
 */

export type PublishState = { dirtyAt: number; publishedAt: number };

export type PublishTiming = {
  /** Publish once writes have been quiet this long… */
  quietSec: number;
  /** …or once this long has passed since the last publish, even mid-burst. */
  maxWaitSec: number;
  /** Republish at least this often (new uploads in channel feeds arrive
   * without a database write); also the history-replay cadence. */
  intervalSec: number;
};

export const DEFAULT_TIMING: PublishTiming = {
  quietSec: 30,
  maxWaitSec: 120,
  intervalSec: 1800,
};

const TICK_MS = 10_000;
const RETRY_AFTER_FAILURE_SEC = 60;

export function publishReason(
  state: PublishState,
  now: number,
  timing: PublishTiming,
): "changed" | "interval" | null {
  const sincePublish = now - state.publishedAt;
  if (
    state.dirtyAt > state.publishedAt &&
    (now - state.dirtyAt >= timing.quietSec || sincePublish >= timing.maxWaitSec)
  ) {
    return "changed";
  }
  if (sincePublish >= timing.intervalSec) return "interval";
  return null;
}

export type FeedPublisherDeps = {
  readState: () => PublishState;
  markPublished: (at: number) => void;
  publish: () => Promise<{ feedCount: number; itemCount: number }>;
  replay: () => Promise<unknown>;
  now?: () => number;
  log?: (msg: string) => void;
  timing?: PublishTiming;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createFeedPublisher(deps: FeedPublisherDeps): {
  tick: () => Promise<void>;
} {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const timing = deps.timing ?? DEFAULT_TIMING;
  let running = false;
  let failedUntil = 0;
  let lastReplayAt = 0;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const startedAt = now();
      const reason =
        startedAt >= failedUntil
          ? publishReason(deps.readState(), startedAt, timing)
          : null;
      if (reason) {
        try {
          const { feedCount, itemCount } = await deps.publish();
          // One second back: a write landing in the same second this run
          // started stays newer than the stamp and triggers the next publish.
          // Publishing itself writes no table a feed trigger watches.
          deps.markPublished(startedAt - 1);
          log(`feed publisher: pushed ${feedCount} feed(s), ${itemCount} item(s) (${reason})`);
        } catch (error) {
          failedUntil = startedAt + RETRY_AFTER_FAILURE_SEC;
          log(`feed publisher: publish failed, retrying in ${RETRY_AFTER_FAILURE_SEC}s: ${message(error)}`);
        }
      }
      if (startedAt - lastReplayAt >= timing.intervalSec) {
        lastReplayAt = startedAt;
        try {
          await deps.replay();
        } catch (error) {
          log(`feed publisher: history replay failed: ${message(error)}`);
        }
      }
    } finally {
      running = false;
    }
  }

  return { tick };
}

let started = false;

/** Start publishing from this process. Only the prod container sets
 * OWNTUBE_PUBLISH_TARGET: dev shares its database, and two publishers would
 * race. */
export function startFeedPublisher(): boolean {
  const target = process.env.OWNTUBE_PUBLISH_TARGET?.trim() ?? "";
  const secret = process.env.OWNTUBE_PUBLISH_SECRET?.trim() ?? "";
  if (started || !target || !secret) return false;
  started = true;

  // Origin used to build enclosure/link URLs. Enclosures are further rewritten
  // to NEXT_PUBLIC_MEDIA_BASE_URL by toMediaOriginUrl, so this is mainly the app link.
  const appOrigin =
    process.env.OWNTUBE_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    "http://localhost:3000";
  const interval = Number.parseInt(process.env.OWNTUBE_PUBLISH_INTERVAL_SEC ?? "", 10);
  const timing: PublishTiming = {
    ...DEFAULT_TIMING,
    ...(interval > 0 ? { intervalSec: interval } : {}),
  };
  const log = (msg: string) => console.log(`[OwnTube] ${msg}`);
  const db = getDb();

  const publisher = createFeedPublisher({
    readState: () => {
      const row = db.get<{ dirty_at: number; published_at: number } | undefined>(
        sql`SELECT dirty_at, published_at FROM feed_publish_state WHERE id = 1`,
      );
      return { dirtyAt: row?.dirty_at ?? 0, publishedAt: row?.published_at ?? 0 };
    },
    markPublished: (at) => {
      db.run(sql`UPDATE feed_publish_state SET published_at = ${at} WHERE id = 1`);
    },
    publish: () => publishFeeds(db, { target, secret, appOrigin, onLog: log }),
    replay: () => replayRecentHistory(db, { onLog: log }),
    timing,
    log,
  });

  setInterval(() => void publisher.tick(), TICK_MS).unref();
  void publisher.tick();
  log(`feed publisher on → ${target} (interval ${timing.intervalSec}s)`);
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web exec vitest run src/server/remote/publish-loop.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Start it from `instrumentation.ts`**

Make `register` async and start the publisher right after `warnQuotedEnvValues();`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  warnQuotedEnvValues();

  // Imported lazily: it pulls in the database and must stay out of the edge bundle.
  if (process.env.OWNTUBE_PUBLISH_TARGET?.trim()) {
    const { startFeedPublisher } = await import("@/server/remote/publish-loop");
    startFeedPublisher();
  }
```

(the rest of `register` is unchanged).

- [ ] **Step 6: Typecheck, lint, and prove it runs**

Run: `pnpm --filter web typecheck && pnpm lint`
Expected: no errors.

Run a local end-to-end check against a local feeds server:

```bash
cd feeds/server && (PUBLISH_SECRET=s DATA_DIR=$(mktemp -d) PORT=8098 npx tsx server.ts & echo $! > /tmp/fs.pid)
cd ../../ && OWNTUBE_PUBLISH_TARGET=http://localhost:8098 OWNTUBE_PUBLISH_SECRET=s \
  DATABASE_PATH=$(mktemp -d)/owntube.db timeout 40 pnpm --filter web dev 2>&1 | grep -m1 "feed publisher"
kill $(cat /tmp/fs.pid)
```
Expected: `[OwnTube] feed publisher on → http://localhost:8098 (interval 1800s)` and, a moment later, a `pushed … feed(s)` line (with a fresh database, 0 feeds is fine).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/server/remote/publish-loop.ts apps/web/src/server/remote/publish-loop.test.ts apps/web/src/instrumentation.ts
git commit -m "Publish feeds from the web app instead of a pusher container"
```

---

### Task 7: Remove the pusher

**Files:**
- Delete: `feeds/pusher/` (`push-feeds.ts`, `tsconfig.json`)
- Modify: `apps/web/package.json` (drop `push:feeds`), `apps/web/Dockerfile` (drop `COPY feeds feeds` and its comment), `apps/web/src/server/hooks/replay-history.ts` (doc comment), `hooks/README.md` (line 47)

- [ ] **Step 1: Delete and update references**

```bash
git rm -r feeds/pusher
```

- `apps/web/package.json`: remove the `"push:feeds": …` line (and the trailing comma on the line before it).
- `apps/web/Dockerfile`: remove these three lines:

```dockerfile
# The feeds pusher entrypoint lives outside apps/web but runs from this image
# (pnpm push:feeds resolves ../../feeds/pusher).
COPY feeds feeds
```

- `apps/web/src/server/hooks/replay-history.ts`: change "Runs from the feeds pusher after every push cycle." to "Runs from the in-app feed publisher (publish-loop.ts) once per publish interval."
- `hooks/README.md`: replace "Set on **both** the app container (live events) and the feeds-pusher container (replay sweep)." with "Set on the app container; it fires both live events and the replay sweep."

- [ ] **Step 2: Verify nothing still refers to the pusher**

Run: `grep -rn -E "feeds/pusher|push:feeds|push-feeds|feeds-pusher" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=superpowers .`
Expected: no output.

Run: `pnpm --filter web typecheck && pnpm --filter web test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A apps/web hooks feeds
git commit -m "Remove the feeds pusher"
```

---

### Task 8: Deploy and verify end to end

Every step here changes production. **Confirm with the user before each numbered step.**

- [ ] **Step 1: Hub on spiff.** Copy `feeds/hub` to spiff (next to the feeds server — find its directory with `docker inspect owntube-feeds-server --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'`) with `rsync -a --exclude node_modules --exclude data feeds/hub/ <spiff-dest>/` (node_modules is reinstalled/rebuilt on spiff; `data/` holds the hub's own SQLite subscriptions and must not be overwritten), write `.env` with `HUB_PUBLISH_TOKEN=$(openssl rand -hex 32)`, `docker compose up -d --build`. Check: `curl -s https://websub.nedworks.org/health` → `ok`.
- [ ] **Step 2: Feeds server on spiff.** Update it to this branch's `feeds/server`, add to its `.env`: `HUB_URL=https://websub.nedworks.org/`, `HUB_PUBLISH_URL=http://websub-hub:8080/`, `HUB_PUBLISH_TOKEN=<same as hub>`, `PUBLIC_URL=https://owntube.nedworks.org`; rebuild. Check the log line `feeds-server: WebSub hub https://websub.nedworks.org/`, and that `curl -s -u '<user>:<rss-pass>' https://owntube.nedworks.org/rss/queue/queue.audio.xml | grep 'rel="hub"'` shows the hub link and a credentialed self link.
- [ ] **Step 3: Web app on naggon.** `git -C /usr/local/src/owntube pull`. First read `/var/data/config/owntube/docker-compose.yml` and `docker-compose.dev.yml` as they actually are — don't assume their current shape. `OWNTUBE_PUBLISH_TARGET` may already be set on the dev/prod `owntube` service for the settings UI's copyable feed URLs; only `OWNTUBE_PUBLISH_SECRET` is the one that must never reach dev. So: copy `OWNTUBE_PUBLISH_SECRET`, `OWNTUBE_PUBLISH_INTERVAL_SEC` (if set) and `OWNTUBE_APP_URL` from the `owntube-feeds-pusher` service to the prod `owntube` service, and ensure `OWNTUBE_PUBLISH_TARGET` is present there too — without duplicating the key if the prod service already sets it. Delete the `owntube-feeds-pusher` service. Confirm `docker-compose.dev.yml` sets **no** `OWNTUBE_PUBLISH_SECRET` (leaving any existing `OWNTUBE_PUBLISH_TARGET` there alone). Then `docker compose -f docker-compose.yml up -d --build --remove-orphans` (don't pipe the build through `tail` — it masks failures). Check the prod logs for `feed publisher on →` and a `pushed … feed(s)` line.
- [ ] **Step 4: Pocket Casts subscribes.** Pocket Casts only sees the hub after it next re-fetches a feed. Watch `docker logs -f websub-hub` for `subscribe confirmed:` lines (can take hours). Then add a video to the OwnTube queue and time how long until `delivered … → <callback>` appears and the episode shows in Pocket Casts. Expected: under a minute to the hub delivery.
- [ ] **Step 5: Outage recovery still works.** In the prod logs, confirm a history replay ran at startup (hook/webhook activity with `OT_SOURCE=replay`, or the n8n owntube-playback flow receiving `source: replay`).
- [ ] **Step 6: Update memory.** Record in `owntube-link-status` (pocket-sessions-server memory) that the pusher is gone, the hub is live at `websub.nedworks.org`, and where its token lives.
