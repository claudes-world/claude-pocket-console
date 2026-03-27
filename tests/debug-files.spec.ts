import { test, expect } from "@playwright/test";

test.describe("File Viewer Debug", () => {
  test("browse and view a file - desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");

    // Switch to files tab
    await page.click("button:has-text('files')");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/files-browse-desktop.png" });

    // Click on IDENTITY.md
    const identityEntry = page.locator("text=IDENTITY.md");
    if (await identityEntry.isVisible()) {
      await identityEntry.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "test-results/files-view-identity-desktop.png" });
    }
  });

  test("browse and view a file - mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await page.click("button:has-text('files')");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/files-browse-mobile.png" });

    const identityEntry = page.locator("text=IDENTITY.md");
    if (await identityEntry.isVisible()) {
      await identityEntry.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "test-results/files-view-identity-mobile.png" });
    }
  });

  test("navigate to ~/code directory", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");

    await page.click("button:has-text('files')");
    await page.waitForTimeout(1000);

    // Go up to parent
    const upButton = page.locator("button:has-text('< up')");
    if (await upButton.isVisible()) {
      await upButton.click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: "test-results/files-parent-dir.png" });
  });
});
