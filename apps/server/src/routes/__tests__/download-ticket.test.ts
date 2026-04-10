import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetRealRootCacheForTests } from "../../lib/path-allowed.js";

let sandbox: string;
let testAllowedRoots: string[] = [];

vi.mock("../../lib/path-allowed.js", async () => {
  const real = await vi.importActual<typeof import("../../lib/path-allowed.js")>(
    "../../lib/path-allowed.js",
  );
  return {
    ...real,
    isPathAllowed: async (candidate: string, _ignoredAllowedRoots: string[]) => {
      return real.isPathAllowed(candidate, testAllowedRoots);
    },
  };
});

const { filesRoute } = await import("../files.js");

beforeAll(() => {
  process.env.NODE_ENV = "test";
  sandbox = mkdtempSync(join(tmpdir(), "cpc-download-ticket-"));
  testAllowedRoots = [sandbox];
  __resetRealRootCacheForTests();
  writeFileSync(join(sandbox, "sample.html"), "<h1>download me</h1>");
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  __resetRealRootCacheForTests();
});

describe("download tickets", () => {
  it("downloads once with hardened attachment headers", async () => {
    const ticketRes = await filesRoute.request("/download-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: join(sandbox, "sample.html") }),
    });
    expect(ticketRes.status).toBe(200);

    const { ticket } = await ticketRes.json() as { ticket: string };
    expect(ticket).toMatch(/^[0-9a-f]{32}$/);

    const downloadRes = await filesRoute.request(`/download?ticket=${ticket}`);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(downloadRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(downloadRes.headers.get("Cache-Control")).toBe("no-store");
    expect(downloadRes.headers.get("Content-Length")).toBe("20");
    expect(downloadRes.headers.get("Content-Disposition")).toContain("attachment; filename=\"sample.html\"");
    expect(await downloadRes.text()).toBe("<h1>download me</h1>");

    const reuseRes = await filesRoute.request(`/download?ticket=${ticket}`);
    expect(reuseRes.status).toBe(403);
    expect(await reuseRes.json()).toEqual({ error: "invalid or expired ticket" });
  });
});
