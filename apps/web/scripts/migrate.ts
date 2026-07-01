import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { runSqlMigrations } from "../src/server/db/run-migrations";
import * as schema from "../src/server/db/schema";

const defaultPath = path.join(process.cwd(), "data", "owntube.db");
const dbPath = process.env.DATABASE_PATH ?? defaultPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

const migrationsFolder = path.join(process.cwd(), "src/server/db/migrations");

void db;
runSqlMigrations(sqlite, migrationsFolder);

sqlite.close();
