import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

function isIgnorableMigrationError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("already exists") ||
    m.includes("duplicate column name") ||
    (m.includes("index") && m.includes("already exists"))
  );
}

export function runSqlMigrations(
  sqlite: Database.Database,
  folder: string,
): void {
  const files = fs
    .readdirSync(folder)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const fullPath = path.join(folder, file);
    const sql = fs.readFileSync(fullPath, "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        sqlite.exec(stmt);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!isIgnorableMigrationError(msg)) {
          throw error;
        }
      }
    }
  }
}
