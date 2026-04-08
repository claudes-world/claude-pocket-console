import { test, expect } from "@playwright/test";

/**
 * E2E smoke test for the Search UX bundle:
 *   - #105 (C1) backdrop opacity bumped to 0.85
 *   - #107 (C2) inline SVG file-type icons (no more 📄/📁 emoji)
 *   - #108 (C3) "Current folder only" toggle + localStorage persistence
 *
 * Network requests are mocked the same way as paste-sheet-repro.spec.ts so
 * the test runs without a real backend. Run against the dev server:
 *
 *   pnpm exec playwright test tests/search-sheet-e2e.spec.ts
 *
 * Requires cpc-dev.service (or `pnpm dev`) to be serving the app on the
 * baseURL configured in playwright.config.ts.
 */

test.describe("Search sheet (Search UX C1/C2/C3)", () => {
  test("backdrop, icons, toggle, and persistence work end-to-end", async ({ page }) => {
    // iPhone-ish viewport so the test matches the Telegram mini app's UAT target.
    await page.setViewportSize({ width: 390, height: 844 });

    // Stub auth — same pattern as paste-sheet-repro.spec.ts.
    // IMPORTANT: do NOT pre-seed `cpc:search:currentFolderOnly`. The toggle's
    // default in ActionBar.tsx is "true unless storage explicitly says false",
    // and the persistence assertion at the end of this test relies on knowing
    // that the OFF state we read after reload was actually WRITTEN by the
    // toggle's useEffect during this test run — not pre-seeded by the test
    // harness. (Codex review round 2.)
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("cpc-session-token", "test-token");
      } catch {}
    });

    // Mock the directory listing so the Files tab renders without a backend.
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
          ],
        }),
      });
    });

    // Mock dir-branch — same shape as paste-sheet-repro.spec.ts.
    await page.route("**/api/terminal/dir-branch**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          branch: "main",
          isWorktree: false,
          treeType: "main",
          mainTreePath: "/home/claude/claudes-world",
        }),
      });
    });

    // Mock the search endpoint with a couple of file results so the icon
    // assertion below has more than one SVG to compare.
    //
    // SCOPE NOTE: this E2E spec covers the FILE branch of getFileIcon as it
    // composes through FileSearchSheet. It does NOT exercise the folder
    // branch because there's a known production bug where FileSearchSheet
    // checks `result.type === "directory"` (FileSearchSheet.tsx:79) while
    // the live server returns `type: "dir"` (apps/server/src/routes/files.ts).
    // Adding a dir-result row here would either (a) test the buggy code
    // path with a fake "directory" string the real server never sends, or
    // (b) silently fall through to the default DocIcon, which doesn't lock
    // in the folder-specific contract anyway. The folder branch of
    // getFileIcon is covered directly by the unit test at
    // apps/web/src/__tests__/file-icons.test.tsx (the "folders" describe
    // block), which is the right level for that contract. Once the
    // dir-vs-directory mismatch in FileSearchSheet is fixed in a separate
    // PR, this E2E spec can add a dir row and tighten the icon assertion.
    let searchHits = 0;
    const lastSearchUrls: string[] = [];
    await page.route("**/api/files/search**", async (route) => {
      searchHits++;
      lastSearchUrls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              name: "config.json",
              path: "/home/claude/claudes-world/config.json",
              type: "file",
              relPath: "~/claudes-world/config.json",
            },
            {
              name: "README.md",
              path: "/home/claude/claudes-world/README.md",
              type: "file",
              relPath: "~/claudes-world/README.md",
            },
          ],
        }),
      });
    });

    await page.goto("/");

    // Switch to the Files tab. DOM text is lowercase, CSS capitalizes it.
    const filesTab = page.locator("button", { hasText: /^files$/ });
    await filesTab.click();

    // Open the Search sheet. The button text is "Search" (see ActionBar.tsx).
    const searchBtn = page.locator("button", { hasText: /^Search$/ });
    await expect(searchBtn).toBeVisible({ timeout: 5000 });
    await searchBtn.click();

    // The search input is rendered inside FileSearchSheet — the only
    // <input placeholder="Search files..."> in the app.
    const searchInput = page.locator('input[placeholder="Search files..."]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    // ── C1 (#105): backdrop opacity ────────────────────────────────────────
    // The backdrop is the outermost div inside the BottomSheet portal. It
    // has `position: fixed; inset: 0; background: rgba(0,0,0,0.85)`. We
    // locate it by walking up from the input until we find the fixed-inset
    // ancestor — but it's faster and more robust to just locate the only
    // fixed-position rgba(0,0,0,0.85) backdrop on the page via its computed
    // style. Use evaluate() so we read the computed value, not the source.
    const backdropBg = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("div"));
      for (const el of candidates) {
        const cs = window.getComputedStyle(el);
        if (cs.position === "fixed" && cs.inset === "0px" && cs.backgroundColor) {
          if (cs.backgroundColor.includes("0.85") || cs.backgroundColor === "rgba(0, 0, 0, 0.85)") {
            return cs.backgroundColor;
          }
        }
      }
      return null;
    });
    expect(backdropBg).toBe("rgba(0, 0, 0, 0.85)");

    // ── C2 (#107): non-emoji icons render ──────────────────────────────────
    // Type a query to trigger the search and render results.
    await searchInput.fill("co"); // ≥2 chars to clear the minimum-length guard
    // Wait for at least one result row to appear.
    const resultRow = page.locator('button:has-text("config.json")');
    await expect(resultRow).toBeVisible({ timeout: 5000 });

    // The result row should contain an inline <svg> (the new file-icons
    // markup), not a 📄 or 📁 emoji. Asserts BOTH file rows in the mock so
    // a regression that breaks one extension's icon path doesn't slip
    // through on a single-row spot check.
    const jsonRow = page.locator('button:has-text("config.json")');
    const mdRow = page.locator('button:has-text("README.md")');
    await expect(mdRow).toBeVisible({ timeout: 3000 });

    for (const row of [jsonRow, mdRow]) {
      await expect(row.locator("svg").first()).toBeVisible();
      const rowText = (await row.textContent()) ?? "";
      expect(rowText).not.toContain("📄");
      expect(rowText).not.toContain("📁");
    }

    // ── C3 (#108): toggle scopes the request and persists across reload ────
    // The toggle defaults to ON (see ActionBar.tsx). The "co" search above
    // already fired at least one request; that request must have included
    // `scope=` because the default state is ON and dir-branch reported a
    // current folder of /home/claude/claudes-world.
    const expectedScope = "/home/claude/claudes-world";
    const expectedScopeEncoded = encodeURIComponent(expectedScope);

    const toggle = page.locator('input[type="checkbox"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked(); // default ON

    // The first search MUST have carried scope=<expectedScope>. Parse the
    // recorded URLs and assert exact equality on the decoded scope param —
    // not just "some scope param exists", which would pass for a stale or
    // wrong value. (Codex review round 2.)
    expect(searchHits).toBeGreaterThan(0);
    const initialScopes = lastSearchUrls.map((url) => new URL(url).searchParams.get("scope"));
    expect(initialScopes).toContain(expectedScope);
    // Sanity check on the encoding too — the client builds the URL via
    // encodeURIComponent, so the raw URL string should contain the encoded
    // form (forward slashes encoded as %2F).
    expect(lastSearchUrls.some((url) => url.includes(`scope=${expectedScopeEncoded}`))).toBe(true);

    // Now uncheck → the search effect should re-fire WITHOUT a scope param,
    // and localStorage should flip to "false".
    const hitsBeforeUncheck = searchHits;
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => searchHits, { timeout: 3000 }).toBeGreaterThan(hitsBeforeUncheck);

    // The post-uncheck request must NOT carry a scope param — that's the
    // whole point of the toggle.
    const urlsAfterUncheck = lastSearchUrls.slice(hitsBeforeUncheck);
    expect(urlsAfterUncheck.length).toBeGreaterThan(0);
    for (const url of urlsAfterUncheck) {
      expect(new URL(url).searchParams.get("scope")).toBeNull();
    }

    // The toggle write must have hit localStorage. This proves the WRITE
    // path of persistence; the reload below then proves the READ path.
    const persistedValue = await page.evaluate(() =>
      window.localStorage.getItem("cpc:search:currentFolderOnly"),
    );
    expect(persistedValue).toBe("false");

    // Close the sheet by clicking the backdrop (BottomSheet's onClick is the
    // backdrop div; the inner sheet has its own stopPropagation guard).
    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("div"));
      for (const el of candidates) {
        const cs = window.getComputedStyle(el);
        if (cs.position === "fixed" && cs.inset === "0px" && cs.backgroundColor === "rgba(0, 0, 0, 0.85)") {
          (el as HTMLDivElement).click();
          return;
        }
      }
    });
    await expect(searchInput).toBeHidden({ timeout: 2000 });

    // RELOAD the page so the React tree is torn down and rebuilt. The toggle's
    // useState initializer must re-read localStorage and recover the OFF
    // state. The init script does NOT re-seed the scope key (only the auth
    // token), so this assertion would fail if either the WRITE on uncheck or
    // the READ on mount were broken.
    await page.reload();

    // Re-open and verify the toggle state survived the reload.
    const filesTabAfter = page.locator("button", { hasText: /^files$/ });
    await filesTabAfter.click();
    const searchBtnAfter = page.locator("button", { hasText: /^Search$/ });
    await expect(searchBtnAfter).toBeVisible({ timeout: 5000 });
    await searchBtnAfter.click();
    const searchInputAfter = page.locator('input[placeholder="Search files..."]');
    await expect(searchInputAfter).toBeVisible({ timeout: 3000 });
    const toggleAfterReload = page.locator('input[type="checkbox"]');
    await expect(toggleAfterReload).not.toBeChecked();
  });
});
