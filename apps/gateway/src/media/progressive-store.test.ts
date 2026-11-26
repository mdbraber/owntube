import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diskProgressiveStore } from "./progressive-store.ts";

describe("diskProgressiveStore", () => {
  it("returns what was stored, and nothing for unknown keys", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gw-progressive-"));
    try {
      const store = diskProgressiveStore(dir);
      const file = {
        size: 42,
        header: Uint8Array.of(0, 1, 2, 255),
        chunks: [{ source: "v136", upstream: { start: 5, end: 9 }, offset: 4 }],
      };
      await store.put("a/v136+a140/1+2", file);
      expect(await store.get("a/v136+a140/1+2")).toEqual(file);
      expect(await store.get("nope")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
