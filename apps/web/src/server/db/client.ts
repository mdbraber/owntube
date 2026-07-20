import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { runSqlMigrations } from "./run-migrations";
import * as schema from "./schema";

const defaultPath = path.join(process.cwd(), "data", "owntube.db");

/** Anchor resolution at the app root (same as `DATABASE_PATH` / Next cwd), not the bundled chunk path. */
const require = createRequire(path.join(process.cwd(), "package.json"));

/** Turbopack can break `bindings`’ `__dirname`; load the `.node` from the real package root. */
function betterSqliteNativePath(): string {
  const pkg = require.resolve("better-sqlite3/package.json");
  const addon = path.join(
    path.dirname(pkg),
    "build",
    "Release",
    "better_sqlite3.node",
  );
  if (!fs.existsSync(addon)) {
    throw new Error(
      `better-sqlite3 native addon not found at ${addon}. From project root, run: pnpm install`,
    );
  }
  return addon;
}

function isBetterSqliteBindingResolutionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Could not locate the bindings file");
}

function openSqlite(dbPath: string): Database.Database {
  try {
    return new Database(dbPath);
  } catch (error) {
    if (!isBetterSqliteBindingResolutionError(error)) {
      throw error;
    }
    return new Database(dbPath, {
      nativeBinding: betterSqliteNativePath(),
    });
  }
}

function createDb() {
  const dbPath = process.env.DATABASE_PATH ?? defaultPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = openSqlite(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Perf pragmas for the read-heavy cache paths + the concurrent cache warmer:
  // NORMAL is safe under WAL (only loses the last txn on OS crash, never
  // corrupts); a 64MB page cache and 256MB mmap keep hot cache rows in memory;
  // busy_timeout avoids SQLITE_BUSY when a request and the warmer write at once.
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("cache_size = -65536");
  sqlite.pragma("mmap_size = 268435456");
  sqlite.pragma("temp_store = MEMORY");
  runSqlMigrations(
    sqlite,
    path.join(process.cwd(), "src/server/db/migrations"),
  );
  return drizzle(sqlite, { schema });
}

export type AppDb = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as {
  __owntubeDb?: AppDb;
};

export function getDb(): AppDb {
  if (!globalForDb.__owntubeDb) {
    globalForDb.__owntubeDb = createDb();
  }
  return globalForDb.__owntubeDb;
}
