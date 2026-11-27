import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { SubscriptionStore } from "./store.ts";
import { topicKey } from "./topic.ts";

const TOPIC = `https://owntube.example/rss/${"a".repeat(32)}/queue/queue.audio.xml`;
const KEY = topicKey(TOPIC) as string;

function fresh(): SubscriptionStore {
  return new SubscriptionStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "websub-store-")),
  );
}

function sub(
  overrides: Partial<Parameters<SubscriptionStore["upsert"]>[0]> = {},
) {
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

test("resubscribing refreshes the stored row", () => {
  const store = fresh();
  store.upsert(sub());
  store.upsert(sub({ expiresAt: 5000 }));
  const active = store.active(KEY, 1000);
  assert.equal(active.length, 1);
  assert.equal(active[0].expiresAt, 5000);
});

test("remove deletes the subscription once", () => {
  const store = fresh();
  store.upsert(sub());
  assert.equal(store.remove(sub().callback, TOPIC), true);
  assert.equal(store.active(KEY, 0).length, 0);
  assert.equal(store.remove(sub().callback, TOPIC), false);
});

test("old keys are converted; subscriptions with credentials are dropped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "websub-store-"));
  new SubscriptionStore(dir); // creates the table
  const db = new Database(path.join(dir, "hub.db"));
  db.exec(
    `PRAGMA user_version = 0;
    INSERT INTO subscriptions VALUES ('https://pc.example/a', '@${KEY}', '${TOPIC}', NULL, 3600, 2000);
    INSERT INTO subscriptions VALUES ('https://pc.example/b', 'alice@owntube.example/rss/queue/queue.audio.xml', 'https://alice:pw@owntube.example/rss/queue/queue.audio.xml', NULL, 3600, 2000);`,
  );
  db.close();
  const store = new SubscriptionStore(dir);
  assert.deepEqual(
    store.active(KEY, 0).map((s) => s.callback),
    ["https://pc.example/a"],
  );
  assert.equal(store.pruneExpired(9999), 1);
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
