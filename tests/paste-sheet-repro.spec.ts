import { test, expect } from "@playwright/test";

// Validates the paste-to-upload BottomSheet renders its form controls
// inside the visible viewport (regression test for the v1.8.0 black-screen
// bug where the sheet anchored off-screen because of a transformed ancestor).

test.describe("Paste sheet visibility", () => {
  test("paste sheet form controls are visible after opening", async ({ page }) => {
    // iPhone-ish viewport that matches the Telegram mini app
    await page.setViewportSize({ width: 390, height: 844 });

    // Stub auth so the API calls have a token even though we never let
    // them succeed (we mock the list endpoint below).
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("cpc-session-token", "test-token");
      } catch {}
    });

    // Mock /api/files/list so the FileViewer renders without a real backend.
    // Returns a tiny fake listing rooted at /home/claude/claudes-world.
    await page.route("**/api/files/list**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          path: "/home/claude/claudes-world",
          parent: "/home/claude",
          items: [
            { name: "AGENTS.md", type: "file", size: 1024, mtime: Date.now() / 1000 },
            { name: "TODO.md", type: "file", size: 512, mtime: Date.now() / 1000 },
          ],
        }),
      });
    });

    // Branch endpoint — the FileViewer fetches it but it's optional.
    await page.route("**/api/git/branch**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ branch: "main", treeType: "main" }),
      });
    });

    await page.goto("/");

    // Click into the Files tab. Tab button DOM text is lowercase ("files");
    // CSS text-transform capitalizes it visually but Playwright matches the DOM.
    const filesTab = page.locator("button", { hasText: /^files$/ });
    await filesTab.click();
    await page.waitForTimeout(800);

    await page.screenshot({ path: "test-results/paste-before-open.png" });

    // Click the "+ Paste" button — it lives in the directory listing area.
    const pasteBtn = page.locator("button", { hasText: /Paste/ }).first();
    await expect(pasteBtn).toBeVisible({ timeout: 5000 });
    await pasteBtn.click();
    await page.waitForTimeout(400);

    await page.screenshot({ path: "test-results/paste-after-open.png" });

    // The textarea inside the sheet should be visible AND inside the viewport.
    const textarea = page.locator('textarea[placeholder*="Paste markdown"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });

    const box = await textarea.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("textarea has no bounding box");

    // The textarea must be within viewport horizontally. The original bug
    // anchored it at x ~= -25% of viewport width (off-screen left).
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(box.width).toBeGreaterThan(100);

    // Save / Cancel buttons should also be visible
    const saveBtn = page.locator("button", { hasText: /^Save$/ });
    await expect(saveBtn).toBeVisible();
    const cancelBtn = page.locator("button", { hasText: /^Cancel$/ });
    await expect(cancelBtn).toBeVisible();
  });
});
