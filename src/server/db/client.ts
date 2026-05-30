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

function createDb() {
  const dbPath = process.env.DATABASE_PATH ?? defaultPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath, {
    nativeBinding: betterSqliteNativePath(),
  });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
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
