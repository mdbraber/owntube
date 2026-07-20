/**
 * Runs the Tauri CLI with this developer's local settings injected, so nothing
 * environment-specific has to live in the repo.
 *
 * `tauri.conf.json` ships a neutral `http://localhost:3000` default and no
 * signing team. The real values come from apps/ios/.env (gitignored, see
 * .env.example) and are merged in here via the CLI's `--config` flag.
 *
 * Usage: tsx scripts/tauri.ts ios dev [...]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const APP_DIR = path.resolve(import.meta.dirname, "..");
const ENV_FILE = path.join(APP_DIR, ".env");
/** Written next to the committed capabilities; gitignored. */
const REMOTE_CAPABILITY = path.join(
  APP_DIR,
  "src-tauri/capabilities/remote.local.json",
);

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

/**
 * A remote page may only call Tauri commands (the watch-queue sync) if a
 * capability grants its origin. That origin is per-deployment, so the file is
 * generated rather than committed.
 */
function writeRemoteCapability(url: string) {
  const capability = {
    identifier: "remote",
    description:
      "Generated from OWNTUBE_URL by scripts/tauri.ts — do not commit.",
    windows: ["main"],
    remote: { urls: [new URL(url).origin] },
    permissions: ["core:default", "deep-link:default"],
  };
  fs.writeFileSync(
    REMOTE_CAPABILITY,
    `${JSON.stringify(capability, null, 2)}\n`,
  );
}

/**
 * The .xcodeproj is generated, not committed: Tauri writes the signing team
 * into it on every build, which must never reach the repo. project.yml is the
 * tracked source and takes the team from ${IOS_DEVELOPMENT_TEAM}, so xcodegen
 * has to run with that exported — including for the widget extension, which
 * Tauri's own --config does not reach.
 */
function regenerateXcodeProject(team: string) {
  execFileSync("xcodegen", ["generate", "--quiet"], {
    cwd: path.join(APP_DIR, "src-tauri/gen/apple"),
    env: { ...process.env, IOS_DEVELOPMENT_TEAM: team },
    stdio: "inherit",
  });
}

function main() {
  const fileEnv = readEnvFile(ENV_FILE);
  // A real environment variable wins over .env, so CI can set it directly.
  const url = process.env.OWNTUBE_URL || fileEnv.OWNTUBE_URL;
  const team =
    process.env.IOS_DEVELOPMENT_TEAM || fileEnv.IOS_DEVELOPMENT_TEAM || "";

  if (!url) {
    throw new Error(
      `OWNTUBE_URL is not set. Copy apps/ios/.env.example to apps/ios/.env and ` +
        `point it at your OwnTube server.`,
    );
  }
  new URL(url); // fail early on a malformed value

  writeRemoteCapability(url);
  regenerateXcodeProject(team);

  const override: Record<string, unknown> = {
    app: { windows: [{ label: "main", url }] },
  };
  if (team) override.bundle = { iOS: { developmentTeam: team } };

  execFileSync(
    "pnpm",
    [
      "exec",
      "tauri",
      ...process.argv.slice(2),
      "--config",
      JSON.stringify(override),
    ],
    { cwd: APP_DIR, stdio: "inherit" },
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
