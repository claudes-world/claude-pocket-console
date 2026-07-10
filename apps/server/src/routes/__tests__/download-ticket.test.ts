import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

// `vi.spyOn` can't redefine a named ESM export in place ("Cannot redefine
// property: open" — the module namespace is frozen). Intercept at
// `vi.mock` time instead: wrap the real `open()` so every FileHandle it
// hands back has its `close()` instrumented, before files.ts ever imports
// the module. Every other export passes through untouched (files.ts also
// uses readFile/stat/unlink/etc from this module).
let closeCalls: number[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const originalClose = handle.close.bind(handle);
      handle.close = async (...closeArgs: unknown[]) => {
        closeCalls.push(Date.now());
        return (originalClose as (...a: unknown[]) => Promise<void>)(...closeArgs);
      };
      return handle;
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

  // H2 (server #299): createDownloadResponse used to extract the raw fd
  // (`createReadStream("", { fd: handle.fd, autoClose: true })`) while the
  // FileHandle itself stayed open — two competing owners of one fd, so the
  // FileHandle's own close (GC finalizer) could double-close it or, worse,
  // close an unrelated already-reused fd from a later request. The fix
  // streams via `handle.createReadStream()` so the FileHandle is the sole
  // owner and closes the fd itself exactly once when the stream ends.
  it("closes the underlying FileHandle exactly once per direct-path download (single fd ownership)", async () => {
    closeCalls.length = 0;

    const filePath = join(sandbox, "sample.html");
    const res = await filesRoute.request(`/download?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(200);

    // Fully drain the response body — this is what triggers the
    // FileHandle-owned stream's end-of-stream close.
    const text = await res.text();
    expect(text).toBe("<h1>download me</h1>");

    // Give the stream's close event a tick to fire.
    await new Promise((r) => setTimeout(r, 20));

    // Exactly one FileHandle should have been closed exactly once — no
    // double-close, no leaked (never-closed) handle.
    expect(closeCalls.length).toBe(1);
  });

  afterEach(() => {
    closeCalls.length = 0;
  });
});
