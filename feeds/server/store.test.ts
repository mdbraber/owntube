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
      { username: "alice", passSha256: "a".repeat(64) },
      { username: "bob", passSha256: "b".repeat(64) },
    ],
  );
  assert.equal(store.get("alice", "queue", "queue")?.title, "alice's queue");
  assert.equal(store.get("bob", "queue", "queue")?.title, "bob's queue");
  assert.equal(store.get("carol", "queue", "queue"), null);
  assert.equal(store.list("alice").length, 1);
});

test("replaceAll prunes feeds and users absent from the payload", () => {
  const { store } = freshStore();
  store.replaceAll(
    [snap("alice", "queue", "queue"), snap("alice", "playlist", "tech")],
    [{ username: "alice", passSha256: "a".repeat(64) }],
  );
  store.replaceAll(
    [snap("alice", "queue", "queue")],
    [{ username: "alice", passSha256: "c".repeat(64) }],
  );
  assert.equal(store.get("alice", "playlist", "tech"), null);
  assert.equal(store.getUser("alice")?.passSha256, "c".repeat(64));

  store.replaceAll([], []);
  assert.equal(store.list("alice").length, 0);
  assert.equal(store.getUser("alice"), null);
});

test("legacy ownerless table is migrated and orphans pruned on publish", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feeds-server-store-"));
  {
    // Simulate a pre-per-user database. The filename is the pre-rename one, so
    // this also exercises the `companion.db` -> `feeds.db` adoption in Store.
    const db = new Database(path.join(dir, "companion.db"));
    db.exec(
      `CREATE TABLE feeds (
        kind TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL,
        json TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (kind, slug)
      )`,
    );
    db.prepare(
      "INSERT INTO feeds (kind, slug, title, json, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("queue", "queue", "Queue", "{}", 1);
    db.close();
  }
  const store = new FeedStore(dir);
  // Legacy row survives the migration under owner '' (unreachable via auth)…
  assert.equal(store.list("").length, 1);
  // …and the first publish prunes it.
  store.replaceAll(
    [snap("alice", "queue", "queue")],
    [{ username: "alice", passSha256: "a".repeat(64) }],
  );
  assert.equal(store.list("").length, 0);
  assert.equal(store.list("alice").length, 1);
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
    [{ username: "alice", passSha256: "a".repeat(64) }],
  );
  assert.deepEqual(store.chaptersFor("vidWITHchap"), [
    { startSeconds: 0, title: "Intro" },
    { startSeconds: 90, title: "Main" },
  ]);
  assert.equal(store.chaptersFor("unknown0000"), null);

  // Next publish without that item prunes its chapters.
  store.replaceAll(
    [snap("alice", "queue", "queue")],
    [{ username: "alice", passSha256: "a".repeat(64) }],
  );
  assert.equal(store.chaptersFor("vidWITHchap"), null);
});

test("a legacy companion.db is adopted rather than left behind", () => {
  // A deployed server has the old file in its volume. Starting from an empty
  // database would drop every published snapshot and per-user credential until
  // the next push, so the old name is taken over in place.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feeds-server-store-"));
  {
    const db = new Database(path.join(dir, "companion.db"));
    db.exec("CREATE TABLE marker (id INTEGER PRIMARY KEY)");
    db.prepare("INSERT INTO marker (id) VALUES (1)").run();
    db.close();
  }

  new FeedStore(dir);
  assert.equal(fs.existsSync(path.join(dir, "feeds.db")), true);
  assert.equal(fs.existsSync(path.join(dir, "companion.db")), false);
  // The adopted file is the same one, not a fresh database beside it.
  const reopened = new Database(path.join(dir, "feeds.db"));
  const rows = reopened.prepare("SELECT id FROM marker").all() as {
    id: number;
  }[];
  reopened.close();
  assert.deepEqual(rows, [{ id: 1 }]);
});

test("a fresh data dir just starts a new database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feeds-server-store-"));
  const store = new FeedStore(dir);
  assert.equal(fs.existsSync(path.join(dir, "feeds.db")), true);
  assert.equal(store.list("alice").length, 0);
});

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
