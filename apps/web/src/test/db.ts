import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { runSqlMigrations } from "@/server/db/run-migrations";
import * as schema from "@/server/db/schema";

export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  const migrationsFolder = path.join(process.cwd(), "src/server/db/migrations");
  if (!fs.existsSync(migrationsFolder)) {
    throw new Error(`Missing migrations: ${migrationsFolder}`);
  }
  runSqlMigrations(sqlite, migrationsFolder);
  return { db, sqlite };
}
