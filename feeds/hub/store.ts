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
