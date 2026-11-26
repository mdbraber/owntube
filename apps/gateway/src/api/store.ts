import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Where catalogue answers outlive the process. */
export interface CacheStore {
  get(key: string): { value: unknown; at: number } | undefined;
  /** `expiresAt`: after this the entry is too old even to stand in when YouTube fails. */
  set(key: string, value: unknown, at: number, expiresAt: number): void;
  /** Removes expired entries, then the oldest beyond `maxRows`; returns how many went. */
  prune(now: number, maxRows: number): number;
  close(): void;
}

/** A CacheStore in one SQLite file (Node's built-in `node:sqlite`). */
export function sqliteCacheStore(file: string): CacheStore {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS entries_expires ON entries (expires);
  `);
  const select = db.prepare("SELECT value, at FROM entries WHERE key = ?");
  const upsert = db.prepare(
    "INSERT INTO entries (key, value, at, expires) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at, expires = excluded.expires",
  );
  const expire = db.prepare("DELETE FROM entries WHERE expires < ?");
  const count = db.prepare("SELECT count(*) AS n FROM entries");
  const trim = db.prepare(
    "DELETE FROM entries WHERE key IN (SELECT key FROM entries ORDER BY at LIMIT ?)",
  );
  return {
    get(key) {
      const row = select.get(key) as { value: string; at: number } | undefined;
      return row ? { value: JSON.parse(row.value), at: row.at } : undefined;
    },
    set(key, value, at, expiresAt) {
      upsert.run(key, JSON.stringify(value), at, expiresAt);
    },
    prune(now, maxRows) {
      let removed = Number(expire.run(now).changes);
      const { n } = count.get() as { n: number };
      if (n > maxRows) removed += Number(trim.run(n - maxRows).changes);
      return removed;
    },
    close() {
      db.close();
    },
  };
}
