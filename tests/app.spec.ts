import { test, expect } from "@playwright/test";

test.describe("CPC App", () => {
  test("health check returns ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  test("actions require auth", async ({ request }) => {
    const res = await request.post("/api/actions/git-status");
    expect(res.status()).toBe(401);
  });

  test("files endpoint responds", async ({ request }) => {
    const res = await request.get("/api/files/list?path=/home/claude/claudes-world");
    // 401 in prod (auth required), 200 in dev (auth skipped)
    expect([200, 401]).toContain(res.status());
  });

  test("homepage loads with tabs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("button:has-text('terminal')")).toBeVisible();
    await expect(page.locator("button:has-text('files')")).toBeVisible();
  });

  test("screenshot of terminal tab", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "test-results/terminal-tab.png", fullPage: true });
  });

  test("screenshot of files tab", async ({ page }) => {
    await page.goto("/");
    await page.click("button:has-text('files')");
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "test-results/files-tab.png", fullPage: true });
  });

  test("screenshot of action bar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("button:has-text('/commands')")).toBeVisible();
    await expect(page.locator("button:has-text('Compact')")).toBeVisible();
    await page.screenshot({ path: "test-results/action-bar.png", fullPage: true });
  });
});
