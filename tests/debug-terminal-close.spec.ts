import { test } from "@playwright/test";

test.describe("Terminal Close-up", () => {
  test("telegram mini app viewport", async ({ page }) => {
    // Telegram mini app on iPhone is roughly this size
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto("/");
    await page.waitForTimeout(4000);
    await page.screenshot({ path: "test-results/terminal-telegram-viewport.png", fullPage: true });
  });

  test("terminal with larger font", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto("/");
    await page.waitForTimeout(4000);
    // Zoom in to see text more clearly
    await page.evaluate(() => {
      document.body.style.zoom = "2";
    });
    await page.screenshot({ path: "test-results/terminal-zoomed.png", fullPage: true });
  });
});
