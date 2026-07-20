/**
 * Generates the iOS app icon set from the canonical brand mark in
 * apps/web/public/logo-dark.svg — the same file the web app and its favicons
 * use. Nothing brand-related is duplicated into this app; edit the logo there
 * and re-run `pnpm icon`.
 *
 * The tile/border stripping lives in @owntube/brand-icon, shared with the web
 * app's icon export so both platforms derive icons the same way.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { toFullBleedIcon } from "@owntube/brand-icon";
import sharp from "sharp";

const APP_DIR = path.resolve(import.meta.dirname, "..");
const LOGO_SVG = path.resolve(APP_DIR, "../web/public/logo-dark.svg");
const MASTER_SIZE = 1024;

/**
 * `tauri icon` always emits every platform's icons. This app only ships iOS, so
 * drop the Android and Windows Store sets rather than committing ~300 KB of
 * artifacts nothing builds from. The desktop icon.icns/.ico and the small PNGs
 * stay: `tauri.conf.json`'s `bundle.icon` list references them.
 */
async function pruneUnshippedPlatforms() {
  const icons = path.join(APP_DIR, "src-tauri/icons");
  await fs.rm(path.join(icons, "android"), { recursive: true, force: true });

  const windowsStore = (await fs.readdir(icons)).filter(
    (name) => name.startsWith("Square") || name === "StoreLogo.png",
  );
  await Promise.all(
    windowsStore.map((name) => fs.rm(path.join(icons, name), { force: true })),
  );
}

async function main() {
  const logo = await fs.readFile(LOGO_SVG, "utf8");
  const { svg, background } = toFullBleedIcon(logo);

  const master = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "owntube-icon-")),
    "app-icon.png",
  );
  await sharp(Buffer.from(svg))
    .resize(MASTER_SIZE, MASTER_SIZE)
    .png()
    .toFile(master);

  execFileSync(
    "pnpm",
    ["exec", "tauri", "icon", master, "--ios-color", background],
    { cwd: APP_DIR, stdio: "inherit" },
  );

  await pruneUnshippedPlatforms();
  console.log(`App icons generated from ${path.relative(APP_DIR, LOGO_SVG)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
