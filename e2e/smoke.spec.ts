import { expect, test } from "@playwright/test";

test.describe("P0 smoke", () => {
  test("home shows entry to search", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "owntube home" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Search videos" }),
    ).toBeVisible();
  });

  test("home may show shorts shelf when upstream has shorts", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "owntube home" }),
    ).toBeVisible();
    const shortsHeading = page.getByRole("heading", {
      level: 2,
      name: "Shorts",
    });
    const visible = await shortsHeading
      .waitFor({ state: "visible", timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    if (!visible) return;
    await expect(
      page.getByRole("link", { name: "See all" }).filter({ hasText: /^See all$/ }),
    ).toBeVisible();
    await expect(
      page.locator('a[href^="/shorts?v="]').first(),
    ).toBeVisible();
  });

  test("shorts page loads feed shell", async ({ page }) => {
    await page.goto("/shorts");
    await expect(
      page
        .locator('a[href="/"]')
        .filter({ hasText: /^Home$/ })
        .first()
        .or(
          page.getByText(
            /Loading shorts|No shorts available|Shorts feed is temporarily unavailable/i,
          ),
        ),
    ).toBeVisible({ timeout: 30_000 });
    const active = page.locator('[data-short-active="true"]');
    if ((await active.count()) === 0) return;
    await expect(active).toBeVisible({ timeout: 30_000 });
    await expect(active.getByText(/^Loading…$/)).toBeHidden({
      timeout: 45_000,
    });
    await expect(active.locator("video").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("search page shows form", async ({ page }) => {
    await page.goto("/search");
    await expect(
      page.getByRole("heading", { level: 1, name: "Search" }),
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Search videos" }),
    ).toBeVisible();
  });
});
