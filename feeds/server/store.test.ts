import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import type { FeedSnapshot } from "./render.ts";
import { FeedStore } from "./store.ts";

function snap(owner: string, kind: string, slug: string): FeedSnapshot {
  return {
    kind,
    owner,
    slug,
    title: `${owner}'s ${slug}`,
    updatedAt: 1_700_000_000,
    items: [],
  };
}

function freshStore(): { store: FeedStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feeds-server-store-"));
  return { store: new FeedStore(dir), dir };
}

test("feeds are scoped per owner; same slug can exist twice", () => {
  const { store } = freshStore();
  store.replaceAll(
    [snap("alice", "queue", "queue"), snap("bob", "queue", "queue")],
    [
      { username: "alice", feedToken: "a".repeat(32) },
      { username: "bob", feedToken: "b".repeat(32) },
    ],
  );
  assert.equal(store.get("alice", "queue", "queue")?.title, "alice's queue");
  assert.equal(store.get("bob", "queue", "queue")?.title, "bob's queue");
  assert.equal(store.get("carol", "queue", "queue"), null);
  assert.equal(store.list("alice").length, 1);
});

test("replaceAll prunes feeds and users absent from the payload", () => {
  const { store } = freshStore();
  const token = "1".repeat(32);
  store.replaceAll(
    [snap("alice", "queue", "queue"), snap("alice", "playlist", "tech")],
    [{ username: "alice", feedToken: token }],
  );
  store.replaceAll(
    [snap("alice", "queue", "queue")],
    [{ username: "alice", feedToken: token }],
  );
  assert.equal(store.get("alice", "playlist", "tech"), null);
  assert.equal(store.getUserByToken(token)?.username, "alice");

  store.replaceAll([], []);
  assert.equal(store.list("alice").length, 0);
  assert.equal(store.getUserByToken(token), null);
});

test("chapters index rebuilds from pushed items", () => {
  const { store } = freshStore();
  const withChapters = {
    ...snap("alice", "queue", "queue"),
    items: [
      {
        videoId: "vidWITHchap",
        title: "T",
        enclosureAudio: "https://m/a.m4a",
        enclosureVideo: "https://m/a.mp4",
        chapters: [
          { startSeconds: 0, title: "Intro" },
          { startSeconds: 90, title: "Main" },
        ],
      },
    ],
  };
  store.replaceAll(
    [withChapters],
    [{ username: "alice", feedToken: "a".repeat(32) }],
  );
  assert.deepEqual(store.chaptersFor("vidWITHchap"), [
    { startSeconds: 0, title: "Intro" },
    { startSeconds: 90, title: "Main" },
  ]);
  assert.equal(store.chaptersFor("unknown0000"), null);

  // Next publish without that item prunes its chapters.
  store.replaceAll(
    [snap("alice", "queue", "queue")],
    [{ username: "alice", feedToken: "a".repeat(32) }],
  );
  assert.equal(store.chaptersFor("vidWITHchap"), null);
});

test("a fresh data dir just starts a new database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feeds-server-store-"));
  const store = new FeedStore(dir);
  assert.equal(fs.existsSync(path.join(dir, "feeds.db")), true);
  assert.equal(store.list("alice").length, 0);
});

test("replaceAll reports feeds whose content changed, ignoring updatedAt", () => {
  const { store } = freshStore();
  const users = [{ username: "alice", feedToken: "a".repeat(32) }];
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

test("feed tokens are stored and looked up exactly", () => {
  const { store } = freshStore();
  const tokA = "a".repeat(32);
  store.replaceAll(
    [snap("alice", "queue", "queue")],
    [{ username: "alice", feedToken: tokA }],
  );
  assert.equal(store.getUserByToken(tokA)?.username, "alice");
  assert.equal(store.tokenFor("alice"), tokA);
  assert.equal(store.tokenFor("bob"), null);
  assert.equal(store.getUserByToken("A".repeat(32)), null);
  assert.equal(store.getUserByToken("a".repeat(31)), null);
  assert.equal(store.getUserByToken("b".repeat(32)), null);
});

test("a new token replaces the old one", () => {
  const { store } = freshStore();
  const users = (feedToken: string) => [{ username: "alice", feedToken }];
  store.replaceAll([], users("1".repeat(32)));
  store.replaceAll([], users("2".repeat(32)));
  assert.equal(store.getUserByToken("1".repeat(32)), null);
  assert.equal(store.getUserByToken("2".repeat(32))?.username, "alice");
});

test("upgrading drops the password hashes and keeps the tokens", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feeds-server-store-"));
  {
    // The version 1 users table, as deployed before.
    const db = new Database(path.join(dir, "feeds.db"));
    db.exec(
      `CREATE TABLE users (username TEXT PRIMARY KEY, pass_sha256 TEXT NOT NULL,
         updated_at INTEGER NOT NULL, feed_token TEXT);
       CREATE UNIQUE INDEX users_feed_token ON users(feed_token) WHERE feed_token IS NOT NULL;
       INSERT INTO users VALUES ('alice', '${"a".repeat(64)}', 1, '${"1".repeat(32)}');
       INSERT INTO users VALUES ('bob', '${"b".repeat(64)}', 1, NULL);`,
    );
    db.close();
  }
  const store = new FeedStore(dir);
  assert.equal(store.getUserByToken("1".repeat(32))?.username, "alice");
  assert.equal(store.tokenFor("bob"), null);
  const check = new Database(path.join(dir, "feeds.db"));
  const cols = check.prepare("PRAGMA table_info(users)").all() as {
    name: string;
  }[];
  check.close();
  assert.deepEqual(
    cols.map((c) => c.name),
    ["username", "feed_token", "updated_at"],
  );
  // Opening again is a no-op.
  assert.equal(new FeedStore(dir).tokenFor("alice"), "1".repeat(32));
});

test("an unreadable stored feed is left out of the list", () => {
  const { store, dir } = freshStore();
  store.replaceAll(
    [snap("alice", "queue", "queue"), snap("alice", "saved", "saved")],
    [{ username: "alice", feedToken: "a".repeat(32) }],
  );
  const db = new Database(path.join(dir, "feeds.db"));
  db.prepare("UPDATE feeds SET json = '{' WHERE kind = 'saved'").run();
  db.close();
  assert.deepEqual(
    store.list("alice").map((r) => r.kind),
    ["queue"],
  );
});
