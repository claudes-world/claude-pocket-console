import { defineConfig } from "@playwright/test";

// Playwright resolves test URLs via `new URL(path, baseURL)`. When tests
// call `page.goto("/")`, a leading slash is treated as root-relative and
// the URL constructor STRIPS any path prefix from baseURL — so a
// PLAYWRIGHT_BASE_URL like `https://cpc.claude.do/dev/` would silently
// send tests to `https://cpc.claude.do/` and hit a 404 or the wrong app.
// Refuse to start with a path-prefixed baseURL rather than running a
// whole suite against the wrong origin. For path-prefixed deployments,
// either hit the bare origin of a port-forward to 127.0.0.1:38831 (what
// Caddy proxies /dev/* onto), or change the tests to use relative paths
// like `page.goto(".")` which preserve the prefix.
// (Copilot PR #106 review.)
const rawBaseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:38830";
try {
  const parsed = new URL(rawBaseUrl);
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error(
      `PLAYWRIGHT_BASE_URL has a path prefix (${parsed.pathname}), which is ` +
        `incompatible with the tests' page.goto("/") calls — the leading ` +
        `slash strips the prefix via URL resolution. Use the bare origin ` +
        `(e.g. http://127.0.0.1:38831) or update tests to relative paths.`,
    );
  }
} catch (err) {
  if (err instanceof TypeError) {
    throw new Error(`PLAYWRIGHT_BASE_URL is not a valid URL: ${rawBaseUrl}`);
  }
  throw err;
}

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  use: {
    baseURL: rawBaseUrl,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  outputDir: "./test-results",
});
