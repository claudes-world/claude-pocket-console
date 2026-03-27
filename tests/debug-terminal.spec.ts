import { test } from "@playwright/test";

test.describe("Terminal Debug", () => {
  test("terminal rendering - desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "test-results/debug-terminal-desktop.png", fullPage: true });
  });

  test("terminal rendering - mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "test-results/debug-terminal-mobile.png", fullPage: true });
  });

  test("files tab - desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    await page.click("button:has-text('files')");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "test-results/debug-files-desktop.png", fullPage: true });
  });

  test("files tab - mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.click("button:has-text('files')");
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "test-results/debug-files-mobile.png", fullPage: true });
  });
});
