import { test, expect } from "@playwright/test";

test.describe("Terminal Close-up", () => {
  test("telegram mini app viewport", async ({ page }) => {
    // Telegram mini app on iPhone is roughly this size
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto("/");
    await page.waitForTimeout(4000);

    const scrollMetrics = await page.evaluate(() => ({
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      viewportWidth: window.innerWidth,
    }));

    expect(scrollMetrics.docScrollWidth).toBe(scrollMetrics.docClientWidth);
    expect(scrollMetrics.bodyScrollWidth).toBe(scrollMetrics.bodyClientWidth);

    const wrapperBox = await page.getByTestId("terminal-wrapper").boundingBox();
    const xtermBox = await page.locator(".xterm").boundingBox();

    expect(wrapperBox).not.toBeNull();
    expect(xtermBox).not.toBeNull();
    expect(wrapperBox!.x + wrapperBox!.width).toBeLessThanOrEqual(scrollMetrics.viewportWidth);
    expect(xtermBox!.x + xtermBox!.width).toBeLessThanOrEqual(scrollMetrics.viewportWidth);

    await page.screenshot({ path: "test-results/terminal-telegram-viewport.png", fullPage: true });
  });

  test("terminal survives viewport resize", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.goto("/");
    await page.waitForTimeout(4000);

    await page.setViewportSize({ width: 360, height: 600 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 390, height: 600 });
    await page.waitForTimeout(300);

    await expect(page.locator(".xterm")).toBeVisible();
    await expect(page.getByText(/live|offline/)).toBeVisible();
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
