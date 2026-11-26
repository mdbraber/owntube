import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import type { FixtureFile } from "./exchange.ts";

/** Where the recorded corpus lives: `packages/youtube/fixtures/corpus`. */
export const CORPUS_DIR = fileURLToPath(
  new URL("../../fixtures/corpus/", import.meta.url),
);

export function fixturePath(id: string, dir: string = CORPUS_DIR): string {
  return path.join(dir, `${id}.json.gz`);
}

export async function writeFixture(
  file: FixtureFile,
  dir: string = CORPUS_DIR,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const target = fixturePath(file.id, dir);
  await writeFile(
    target,
    gzipSync(`${JSON.stringify(file, null, 1)}\n`, { level: 9 }),
  );
  return target;
}

export async function readFixture(
  id: string,
  dir: string = CORPUS_DIR,
): Promise<FixtureFile> {
  return JSON.parse(
    gunzipSync(await readFile(fixturePath(id, dir))).toString("utf8"),
  ) as FixtureFile;
}

export async function listFixtures(
  dir: string = CORPUS_DIR,
): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((f) => f.endsWith(".json.gz"))
      .map((f) => f.slice(0, -".json.gz".length))
      .sort();
  } catch {
    return [];
  }
}
