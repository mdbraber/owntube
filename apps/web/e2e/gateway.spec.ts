import { expect, type Page, test } from "@playwright/test";

/**
 * The web app on the gateway, end to end: every page that reads YouTube, and
 * playback actually advancing. Needs a running gateway (GATEWAY_URL) that can
 * reach YouTube; the corpus video is a long-lived public upload.
 */
const VIDEO = "aqz-KE-bpKQ"; // Big Buck Bunny 60fps 4K, Blender Foundation
const CHANNEL = "UCSMOQeBJ2RAnuFungnQOxLg"; // Blender

async function playbackAdvances(page: Page) {
  const video = page.locator("video").first();
  await expect(video).toBeAttached({ timeout: 30_000 });
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play().catch(() => {});
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 45_000,
    })
    .toBeGreaterThan(2);
}

test.describe("on the gateway", () => {
  test("a video page plays from this site alone, DASH where MSE can", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://127.0.0.1:3000").origin;
    const outside: string[] = [];
    const manifests: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.protocol.startsWith("http") && url.origin !== origin)
        outside.push(r.url());
      if (url.pathname.startsWith(`/media/v/${VIDEO}/`))
        manifests.push(url.pathname.split("/").pop() ?? "");
    });
    await page.goto(`/watch?v=${VIDEO}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /Big Buck Bunny/i,
    );
    await playbackAdvances(page);
    // Chromium has MSE and VP9: the player takes the DASH manifest.
    expect(manifests).toContain("manifest.mpd");
    // Nothing went anywhere but this site (no Google, no CDN).
    expect(outside).toEqual([]);
  });

  test("search, a channel and Live list videos", async ({ page }) => {
    await page.goto("/search?q=blender%20open%20movie");
    await expect(page.locator('a[href^="/watch?v="]').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.goto(`/channel/${CHANNEL}`);
    await expect(page.locator('a[href^="/watch?v="]').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.goto("/live");
    await expect(
      page.getByRole("heading", { level: 1, name: "Live", exact: true }),
    ).toBeVisible();
    await expect(page.locator('a[href^="/watch?v="]').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("/trending redirects to /live", async ({ page }) => {
    await page.goto("/trending");
    await expect(page).toHaveURL(/\/live$/);
  });

  test("the gateway's media route answers through the app", async ({
    request,
  }) => {
    const image = await request.get(`/media/img/yti/vi/${VIDEO}/hqdefault.jpg`);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toMatch(/^image\//);
    const unsigned = await request.get(`/media/v/${VIDEO}/manifest.mpd`);
    expect(unsigned.status()).toBe(403);
  });
});
