import { defineConfig } from "drizzle-kit";

const databasePath = process.env.DATABASE_PATH ?? "./data/owntube.db";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
});
