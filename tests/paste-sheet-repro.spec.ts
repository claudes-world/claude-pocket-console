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
    // The items shape must match the real server response at
    // apps/server/src/routes/files.ts — { name, path, type, size, modified }.
    // FileViewer uses entry.path as a React key, so missing path fields
    // cause key collisions. (Copilot round-2 review.)
    await page.route("**/api/files/list**", async (route) => {
      const nowIso = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          path: "/home/claude/claudes-world",
          parent: "/home/claude",
          items: [
            {
              name: "AGENTS.md",
              path: "/home/claude/claudes-world/AGENTS.md",
              type: "file",
              size: 1024,
              modified: nowIso,
            },
            {
              name: "TODO.md",
              path: "/home/claude/claudes-world/TODO.md",
              type: "file",
              size: 512,
              modified: nowIso,
            },
          ],
        }),
      });
    });

    // Branch endpoint — FileViewer actually fetches /api/terminal/dir-branch,
    // not /api/git/branch. (Copilot round-2 review pointed out the earlier
    // stub was a no-op.)
    await page.route("**/api/terminal/dir-branch**", async (route) => {
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

    await page.screenshot({ path: "test-results/paste-before-open.png" });

    // Click the "+ Paste" button — it lives in the directory listing area.
    // Playwright's web-first assertions auto-retry, so no explicit timeouts
    // are needed. (Gemini round-2 review: waitForTimeout is flaky.)
    const pasteBtn = page.locator("button", { hasText: /Paste/ }).first();
    await expect(pasteBtn).toBeVisible({ timeout: 5000 });
    await pasteBtn.click();

    await page.screenshot({ path: "test-results/paste-after-open.png" });

    // The textarea inside the sheet should be visible AND inside the viewport.
    const textarea = page.locator('textarea[placeholder*="Paste markdown"]');
    await expect(textarea).toBeVisible({ timeout: 3000 });

    const box = await textarea.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("textarea has no bounding box");

    // The textarea must be within viewport horizontally. The original bug
    // anchored it at x ~= -25% of viewport width (off-screen left). Derive
    // the viewport width from page state instead of hardcoding it so this
    // stays self-consistent if the setViewportSize call above is changed.
    const viewportSize = page.viewportSize();
    expect(viewportSize).not.toBeNull();
    if (!viewportSize) throw new Error("page has no viewport size");
    const viewportEpsilon = 1; // allow subpixel rounding

    expect(box.x).toBeGreaterThanOrEqual(-viewportEpsilon);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportSize.width + viewportEpsilon);
    expect(box.width).toBeGreaterThan(100);

    // Save / Cancel buttons should also be visible
    const saveBtn = page.locator("button", { hasText: /^Save$/ });
    await expect(saveBtn).toBeVisible();
    const cancelBtn = page.locator("button", { hasText: /^Cancel$/ });
    await expect(cancelBtn).toBeVisible();
  });
});
