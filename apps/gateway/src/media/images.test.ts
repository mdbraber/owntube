import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imageRoutes, pruneImages } from "./images.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gw-images-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function upstream(type = "image/jpeg") {
  const asked: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    asked.push(String(input));
    return new Response(new Uint8Array([0xff, 0xd8, asked.length]), {
      headers: { "content-type": type },
    });
  };
  return { fetch, asked };
}

describe("imageRoutes", () => {
  it("fetches once, then serves from disk", async () => {
    const { fetch, asked } = upstream();
    const app = imageRoutes({ cacheDir: dir, fetch });
    const first = await app.request("/media/img/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/jpeg");
    const second = await app.request("/media/img/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([
      0xff, 0xd8, 1,
    ]);
    expect(asked).toEqual(["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]);
  });

  it("serves a stale image at once and refreshes it in the background", async () => {
    const { fetch, asked } = upstream();
    let clock = 0;
    const app = imageRoutes({ cacheDir: dir, fetch, now: () => clock });
    await app.request("/media/img/vi/x/hqdefault.jpg");
    clock += 25 * 3600 * 1000;
    const stale = await app.request("/media/img/vi/x/hqdefault.jpg");
    expect([...new Uint8Array(await stale.arrayBuffer())]).toEqual([
      0xff, 0xd8, 1,
    ]);
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toHaveLength(2);
  });

  it("keeps the signature query only for storyboards", async () => {
    const { fetch, asked } = upstream();
    const app = imageRoutes({ cacheDir: dir, fetch });
    await app.request("/media/img/sb/x/storyboard3_L2/M0.jpg?sqp=a&sigh=b");
    await app.request("/media/img/vi/x/hqdefault.jpg?track=1");
    expect(asked).toEqual([
      "https://i.ytimg.com/sb/x/storyboard3_L2/M0.jpg?sqp=a&sigh=b",
      "https://i.ytimg.com/vi/x/hqdefault.jpg",
    ]);
  });

  it("reaches only its own hosts", async () => {
    const { fetch, asked } = upstream();
    const app = imageRoutes({ cacheDir: dir, fetch });
    expect((await app.request("/media/img/evil/x.jpg")).status).toBe(404);
    expect((await app.request("/media/img/vi/../../etc/passwd")).status).toBe(
      404,
    );
    expect(asked).toEqual([]);
  });

  it("refuses what is not an image", async () => {
    const { fetch } = upstream("text/html");
    const app = imageRoutes({ cacheDir: dir, fetch });
    expect(
      (await app.request("/media/img/vi/x/maxresdefault.jpg")).status,
    ).toBe(404);
  });
});

describe("pruneImages", () => {
  it("removes the oldest images until the cache fits", async () => {
    const { fetch } = upstream();
    const app = imageRoutes({ cacheDir: dir, fetch });
    for (const name of ["a", "b", "c"]) {
      await app.request(`/media/img/vi/${name}/hqdefault.jpg`);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(await pruneImages(dir, 6)).toBe(1);
  });
});
