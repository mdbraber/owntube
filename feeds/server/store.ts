/**
 * SQLite store for published feed snapshots and the per-user credentials that
 * unlock them. One feed row per (owner, kind, slug); the JSON column holds the
 * whole snapshot the publisher pushed. `replaceAll` mirrors the publisher's
 * full-set semantics: after a publish the store contains exactly the feeds and
 * users in that payload — anything absent (deleted playlist, dropped
 * subscription, removed account) is pruned.
 *
 * Credentials arrive and are stored as SHA-256 hex digests; the plaintext
 * password never leaves the home OwnTube.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { FeedSnapshot } from "./render.ts";
import type { WebSubEvent } from "./websub.ts";

export type FeedRow = {
  owner: string;
  kind: string;
  slug: string;
  title: string;
  updatedAt: number;
  feed: FeedSnapshot;
};

export type UserCredential = {
  username: string;
  /** SHA-256 hex of the user's RSS password. */
  passSha256: string;
};

export type QueuedWebSubEvent = WebSubEvent & {
  id: number;
  receivedAt: number;
};

export type WebSubStats = {
  wanted: number;
  active: number;
  pending: number;
  failing: number;
  queued: number;
};

/** A hub verification only renews the lease when it answers one of our own
 * requests from this recently; see `verifyWebSub`. */
const WEBSUB_PENDING_WINDOW_SEC = 3600;
/** Renew this long before the lease runs out. */
const WEBSUB_RENEW_BEFORE_SEC = 86_400;
/** Unacked events older than this are dropped (home was offline too long —
 * its periodic RSS refresh has caught up by then). */
const WEBSUB_EVENT_RETENTION_SEC = 14 * 86_400;

/** Wait before re-requesting: covers an unanswered verification (15 min)
 * and backs off repeated failures up to 12 h. */
function webSubRetryDelaySec(attempts: number): number {
  const exp = Math.min(Math.max(attempts - 1, 0), 6);
  return Math.min(900 * 2 ** exp, 43_200);
}

export class FeedStore {
  private db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    // Renamed from `companion.db`. A deployed server has the old file in its
    // volume, and starting from an empty database would drop every published
    // snapshot and per-user feed credential until the next push — so adopt it
    // in place rather than ignoring it. One-way and one-time: after the move
    // there is nothing left to find.
    const dbPath = path.join(dataDir, "feeds.db");
    const legacyPath = path.join(dataDir, "companion.db");
    if (!fs.existsSync(dbPath) && fs.existsSync(legacyPath)) {
      for (const suffix of ["", "-wal", "-shm"]) {
        if (fs.existsSync(legacyPath + suffix)) {
          fs.renameSync(legacyPath + suffix, dbPath + suffix);
        }
      }
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS feeds (
        owner TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner, kind, slug)
      );
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        pass_sha256 TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS video_chapters (
        video_id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS websub_topics (
        channel_id TEXT PRIMARY KEY,
        wanted INTEGER NOT NULL,
        requested_mode TEXT,
        requested_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_expires_at INTEGER,
        verified_at INTEGER,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS websub_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        deleted INTEGER NOT NULL,
        title TEXT,
        author TEXT,
        published_at INTEGER,
        updated_at INTEGER,
        received_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS websub_events_dedupe
        ON websub_events (video_id, deleted, IFNULL(updated_at, 0))`,
    );
    this.migrateOwnerColumn();
  }

  /**
   * A pre-per-user database has a feeds table keyed (kind, slug) with no owner.
   * Rebuild with the new key; the orphaned owner='' rows are unreachable (no
   * matching credential) and vanish at the first publish.
   */
  private migrateOwnerColumn(): void {
    const cols = this.db.prepare("PRAGMA table_info(feeds)").all() as {
      name: string;
    }[];
    if (cols.some((c) => c.name === "owner")) return;
    this.db.exec(
      `ALTER TABLE feeds RENAME TO feeds_old;
      CREATE TABLE feeds (
        owner TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner, kind, slug)
      );
      INSERT INTO feeds (owner, kind, slug, title, json, updated_at)
        SELECT '', kind, slug, title, json, updated_at FROM feeds_old;
      DROP TABLE feeds_old`,
    );
  }

  /** Replace the entire published set (feeds and users), atomically. */
  replaceAll(
    feeds: FeedSnapshot[],
    users: UserCredential[],
  ): { upserted: number } {
    const keep = new Set(feeds.map((f) => `${f.owner}:${f.kind}:${f.slug}`));
    const upsert = this.db.prepare(
      `INSERT INTO feeds (owner, kind, slug, title, json, updated_at)
       VALUES (@owner, @kind, @slug, @title, @json, @updatedAt)
       ON CONFLICT(owner, kind, slug) DO UPDATE SET
         title = excluded.title, json = excluded.json, updated_at = excluded.updated_at`,
    );
    const upsertUser = this.db.prepare(
      `INSERT INTO users (username, pass_sha256, updated_at)
       VALUES (@username, @passSha256, unixepoch())
       ON CONFLICT(username) DO UPDATE SET
         pass_sha256 = excluded.pass_sha256, updated_at = excluded.updated_at`,
    );
    const tx = this.db.transaction(
      (rows: FeedSnapshot[], creds: UserCredential[]) => {
        for (const f of rows) {
          upsert.run({
            owner: f.owner,
            kind: f.kind,
            slug: f.slug,
            title: f.title,
            json: JSON.stringify(f),
            updatedAt: f.updatedAt,
          });
        }
        const existing = this.db
          .prepare("SELECT owner, kind, slug FROM feeds")
          .all() as { owner: string; kind: string; slug: string }[];
        const del = this.db.prepare(
          "DELETE FROM feeds WHERE owner = ? AND kind = ? AND slug = ?",
        );
        for (const row of existing) {
          if (!keep.has(`${row.owner}:${row.kind}:${row.slug}`)) {
            del.run(row.owner, row.kind, row.slug);
          }
        }
        for (const c of creds) upsertUser.run(c);
        const usernames = new Set(creds.map((c) => c.username));
        const existingUsers = this.db
          .prepare("SELECT username FROM users")
          .all() as { username: string }[];
        const delUser = this.db.prepare("DELETE FROM users WHERE username = ?");
        for (const u of existingUsers) {
          if (!usernames.has(u.username)) delUser.run(u.username);
        }
        this.replaceChaptersLocked(rows);
      },
    );
    tx(feeds, users);
    return { upserted: feeds.length };
  }

  /** Rebuild the per-video chapters index from the pushed items (full-set
   * semantics, like everything else). Runs inside replaceAll's transaction. */
  private replaceChaptersLocked(feeds: FeedSnapshot[]): void {
    this.db.exec("DELETE FROM video_chapters");
    const upsert = this.db.prepare(
      `INSERT INTO video_chapters (video_id, json, updated_at)
       VALUES (?, ?, unixepoch())
       ON CONFLICT(video_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    );
    for (const feed of feeds) {
      for (const item of feed.items) {
        if (item.chapters && item.chapters.length > 0) {
          upsert.run(item.videoId, JSON.stringify(item.chapters));
        }
      }
    }
  }

  chaptersFor(
    videoId: string,
  ): { startSeconds: number; title: string }[] | null {
    const row = this.db
      .prepare("SELECT json FROM video_chapters WHERE video_id = ?")
      .get(videoId) as { json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.json) as { startSeconds: number; title: string }[];
    } catch {
      return null;
    }
  }

  /**
   * Replace the set of channels home wants push for. Rows for channels no
   * longer wanted stay (wanted = 0) until they are unsubscribed or their
   * lease lapses — see `webSubDue`.
   */
  setWebSubWanted(channelIds: string[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO websub_topics (channel_id, wanted) VALUES (?, 1)
       ON CONFLICT(channel_id) DO UPDATE SET wanted = 1`,
    );
    this.db.transaction((ids: string[]) => {
      this.db.exec("UPDATE websub_topics SET wanted = 0");
      for (const id of ids) upsert.run(id);
    })(channelIds);
  }

  isWebSubWanted(channelId: string): boolean {
    const row = this.db
      .prepare("SELECT wanted FROM websub_topics WHERE channel_id = ?")
      .get(channelId) as { wanted: number } | undefined;
    return row?.wanted === 1;
  }

  /**
   * Channels to (re)subscribe — wanted, lease missing or within a day of
   * expiry — and to unsubscribe — unwanted with a live lease. Channels backing
   * off after a recent request are skipped. Unwanted rows whose lease is gone
   * are deleted here.
   */
  webSubDue(
    now: number,
    limit: number,
  ): { subscribe: string[]; unsubscribe: string[] } {
    this.db
      .prepare(
        `DELETE FROM websub_topics
         WHERE wanted = 0 AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      )
      .run(now);
    const rows = this.db
      .prepare(
        `SELECT channel_id, wanted, requested_at, attempts FROM websub_topics
         WHERE (wanted = 1 AND (lease_expires_at IS NULL OR lease_expires_at < ?))
            OR (wanted = 0 AND lease_expires_at > ?)
         ORDER BY lease_expires_at IS NOT NULL, lease_expires_at`,
      )
      .all(now + WEBSUB_RENEW_BEFORE_SEC, now) as {
      channel_id: string;
      wanted: number;
      requested_at: number | null;
      attempts: number;
    }[];
    const subscribe: string[] = [];
    const unsubscribe: string[] = [];
    for (const r of rows) {
      if (subscribe.length + unsubscribe.length >= limit) break;
      if (
        r.requested_at !== null &&
        now - r.requested_at < webSubRetryDelaySec(r.attempts)
      ) {
        continue;
      }
      (r.wanted === 1 ? subscribe : unsubscribe).push(r.channel_id);
    }
    return { subscribe, unsubscribe };
  }

  /** Record a hub request; `error` set when the hub rejected it outright. */
  markWebSubRequested(
    channelId: string,
    mode: "subscribe" | "unsubscribe",
    now: number,
    error: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE websub_topics
         SET requested_mode = ?, requested_at = ?, attempts = attempts + 1, last_error = ?
         WHERE channel_id = ?`,
      )
      .run(mode, now, error, channelId);
  }

  /**
   * Answer a hub verification GET. Accepted (→ echo the challenge) when it
   * matches what we want. Only a verification of our own recent request
   * moves the lease: the hub also re-verifies live subscriptions on its own,
   * and anyone can send this GET, so an unsolicited one must not be able to
   * postpone a renewal.
   */
  verifyWebSub(
    channelId: string,
    mode: "subscribe" | "unsubscribe",
    leaseSec: number,
    now: number,
  ): boolean {
    const row = this.db
      .prepare(
        "SELECT wanted, requested_mode, requested_at FROM websub_topics WHERE channel_id = ?",
      )
      .get(channelId) as
      | {
          wanted: number;
          requested_mode: string | null;
          requested_at: number | null;
        }
      | undefined;
    if (mode === "unsubscribe") {
      if (row?.wanted === 1) return false;
      if (row) {
        this.db
          .prepare("DELETE FROM websub_topics WHERE channel_id = ?")
          .run(channelId);
      }
      return true;
    }
    if (row?.wanted !== 1) return false;
    const answersOurRequest =
      row.requested_mode === "subscribe" &&
      row.requested_at !== null &&
      now - row.requested_at <= WEBSUB_PENDING_WINDOW_SEC;
    if (answersOurRequest) {
      const lease = Math.min(Math.max(leaseSec, 60), 30 * 86_400);
      this.db
        .prepare(
          `UPDATE websub_topics
           SET lease_expires_at = ?, verified_at = ?, requested_mode = NULL,
               requested_at = NULL, attempts = 0, last_error = NULL
           WHERE channel_id = ?`,
        )
        .run(now + lease, now, channelId);
    }
    return true;
  }

  /** The hub refused the subscription (`hub.mode=denied`). */
  markWebSubDenied(channelId: string, reason: string): void {
    this.db
      .prepare(
        "UPDATE websub_topics SET lease_expires_at = NULL, last_error = ? WHERE channel_id = ?",
      )
      .run(`denied: ${reason}`.slice(0, 500), channelId);
  }

  /** Queue notifications; exact duplicates (the hub often redelivers) collapse. */
  addWebSubEvents(events: WebSubEvent[], now: number): number {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO websub_events
         (channel_id, video_id, deleted, title, author, published_at, updated_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    return this.db.transaction((list: WebSubEvent[]) => {
      let added = 0;
      for (const e of list) {
        added += insert.run(
          e.channelId,
          e.videoId,
          e.deleted ? 1 : 0,
          e.title ?? null,
          e.author ?? null,
          e.publishedAt ?? null,
          e.updatedAt ?? null,
          now,
        ).changes;
      }
      return added;
    })(events);
  }

  /**
   * Delete events up to `ack` (home processed them), prune expired ones, and
   * return the next batch. At-least-once: an event is redelivered until acked.
   */
  drainWebSubEvents(
    ack: number | null,
    limit: number,
    now: number,
  ): QueuedWebSubEvent[] {
    if (ack !== null) {
      this.db.prepare("DELETE FROM websub_events WHERE id <= ?").run(ack);
    }
    this.db
      .prepare("DELETE FROM websub_events WHERE received_at < ?")
      .run(now - WEBSUB_EVENT_RETENTION_SEC);
    const rows = this.db
      .prepare(
        `SELECT id, channel_id, video_id, deleted, title, author, published_at, updated_at, received_at
         FROM websub_events ORDER BY id LIMIT ?`,
      )
      .all(limit) as {
      id: number;
      channel_id: string;
      video_id: string;
      deleted: number;
      title: string | null;
      author: string | null;
      published_at: number | null;
      updated_at: number | null;
      received_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      channelId: r.channel_id,
      videoId: r.video_id,
      deleted: r.deleted === 1,
      title: r.title ?? undefined,
      author: r.author ?? undefined,
      publishedAt: r.published_at ?? undefined,
      updatedAt: r.updated_at ?? undefined,
      receivedAt: r.received_at,
    }));
  }

  webSubStats(now: number): WebSubStats {
    const row = this.db
      .prepare(
        `SELECT
           SUM(wanted = 1) AS wanted,
           SUM(wanted = 1 AND lease_expires_at > ?) AS active,
           SUM(wanted = 1 AND (lease_expires_at IS NULL OR lease_expires_at <= ?) AND last_error IS NULL) AS pending,
           SUM(wanted = 1 AND last_error IS NOT NULL) AS failing
         FROM websub_topics`,
      )
      .get(now, now) as Record<string, number | null>;
    const queued = (
      this.db.prepare("SELECT COUNT(*) AS n FROM websub_events").get() as {
        n: number;
      }
    ).n;
    return {
      wanted: row.wanted ?? 0,
      active: row.active ?? 0,
      pending: row.pending ?? 0,
      failing: row.failing ?? 0,
      queued,
    };
  }

  getUser(username: string): UserCredential | null {
    const row = this.db
      .prepare("SELECT username, pass_sha256 FROM users WHERE username = ?")
      .get(username) as { username: string; pass_sha256: string } | undefined;
    return row ? { username: row.username, passSha256: row.pass_sha256 } : null;
  }

  get(owner: string, kind: string, slug: string): FeedSnapshot | null {
    const row = this.db
      .prepare(
        "SELECT json FROM feeds WHERE owner = ? AND kind = ? AND slug = ?",
      )
      .get(owner, kind, slug) as { json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.json) as FeedSnapshot;
    } catch {
      return null;
    }
  }

  list(owner: string): FeedRow[] {
    const rows = this.db
      .prepare(
        "SELECT owner, kind, slug, title, json, updated_at FROM feeds WHERE owner = ? ORDER BY kind, title",
      )
      .all(owner) as {
      owner: string;
      kind: string;
      slug: string;
      title: string;
      json: string;
      updated_at: number;
    }[];
    return rows.map((r) => ({
      owner: r.owner,
      kind: r.kind,
      slug: r.slug,
      title: r.title,
      updatedAt: r.updated_at,
      feed: JSON.parse(r.json) as FeedSnapshot,
    }));
  }
}
