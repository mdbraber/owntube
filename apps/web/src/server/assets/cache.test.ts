import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAssetInFlight,
  getCachedAsset,
  pruneAssetCache,
} from "@/server/assets/cache";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function imageResponse(body: Buffer = PNG): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

describe("asset cache", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "owntube-assets-"));
    vi.stubEnv("DATABASE_PATH", path.join(dir, "owntube.db"));
    clearAssetInFlight();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fetches once, then serves from disk", async () => {
    const fetcher = vi.fn(async () => imageResponse());
    const first = await getCachedAsset("vi/x/maxres.jpg", "thumbnail", fetcher);
    expect(first?.contentType).toBe("image/png");
    expect(Buffer.compare(first?.body ?? Buffer.alloc(0), PNG)).toBe(0);

    const second = await getCachedAsset("vi/x/maxres.jpg", "thumbnail", fetcher);
    expect(second?.contentType).toBe("image/png");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses non-image responses and memoizes the refusal", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await getCachedAsset("api/v1/foo", "image", fetcher)).toBeNull();
    expect(await getCachedAsset("api/v1/foo", "image", fetcher)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1); // second call short-circuits
  });

  it("returns null on upstream failure with no prior entry", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 502 }));
    expect(await getCachedAsset("vi/y/maxres.jpg", "thumbnail", fetcher)).toBeNull();
  });

  it("shares one upstream fetch across concurrent readers", async () => {
    const fetcher = vi.fn(async () => imageResponse());
    const [a, b] = await Promise.all([
      getCachedAsset("vi/z/maxres.jpg", "thumbnail", fetcher),
      getCachedAsset("vi/z/maxres.jpg", "thumbnail", fetcher),
    ]);
    expect(a?.contentType).toBe("image/png");
    expect(b?.contentType).toBe("image/png");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("prunes least-recently-written entries beyond the size cap", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(4096, 7)]);
    for (const key of ["a", "b", "c"]) {
      await getCachedAsset(`vi/${key}/maxres.jpg`, "thumbnail", async () =>
        imageResponse(big),
      );
    }
    const { removed } = await pruneAssetCache(2 * big.byteLength);
    expect(removed).toBeGreaterThanOrEqual(1);
    // Newest entries survive.
    const fetcher = vi.fn(async () => imageResponse(big));
    await getCachedAsset("vi/c/maxres.jpg", "thumbnail", fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
