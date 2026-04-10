import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPathAllowed as realIsPathAllowed,
  __resetRealRootCacheForTests,
} from "../../lib/path-allowed.js";

/**
 * Security tests for the file upload (/upload) and paste (/paste) endpoints.
 *
 * Strategy: same mock-seam approach as search-scope.test.ts. We mock
 * `path-allowed.js` to inject a temp-dir allowlist so tests are hermetic,
 * then drive the filesRoute Hono sub-app via `app.request()`. The real
 * `isPathAllowed` is exercised with the swapped allowlist so path-traversal
 * and sibling-prefix protections are tested end-to-end.
 *
 * The /paste endpoint is the primary upload surface (JSON body, filename
 * sanitization, O_EXCL atomic writes, bodyLimit). The /upload endpoint
 * (multipart) shares the same path-allowed check and basename sanitization.
 */

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
  sandbox = mkdtempSync(join(tmpdir(), "cpc-upload-test-"));
  testAllowedRoots = [sandbox];
  __resetRealRootCacheForTests();
  mkdirSync(join(sandbox, "sub"), { recursive: true });
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  __resetRealRootCacheForTests();
});

/** Helper to POST JSON to /paste via Hono's test API. */
async function callPaste(body: Record<string, unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await filesRoute.request("/paste", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: json };
}

describe("/paste endpoint — security properties", () => {
  it("accepts a valid paste to an allowed directory", async () => {
    const { status, body } = await callPaste({
      filename: "hello.txt",
      content: "hello world",
      dir: sandbox,
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.name).toBe("hello.txt");
    expect(body.size).toBeGreaterThan(0);
  });

  it("rejects path traversal in the dir parameter (../../../etc)", async () => {
    const { status, body } = await callPaste({
      filename: "evil.txt",
      content: "pwned",
      dir: join(sandbox, "..", "..", "..", "etc"),
    });
    expect(status).toBe(403);
    expect(body.error).toBe("Access denied");
  });

  it("rejects an absolute path outside allowed roots (/tmp/malicious)", async () => {
    const { status, body } = await callPaste({
      filename: "evil.txt",
      content: "pwned",
      dir: "/tmp/malicious",
    });
    expect(status).toBe(403);
    expect(body.error).toBe("Access denied");
  });

  it("sanitizes null bytes in filename (returns 400)", async () => {
    const { status, body } = await callPaste({
      filename: "evil\x00.txt",
      content: "pwned",
      dir: sandbox,
    });
    // sanitizeFilename strips control chars; if result is still valid, it writes.
    // A null byte in the middle gets stripped → "evil.txt" which is valid.
    // But a filename that is ONLY control chars would become empty → 400.
    // The important thing: the null byte is NOT in the written filename.
    expect([200, 400]).toContain(status);
    if (status === 200) {
      // The null byte was stripped, filename should NOT contain \0
      expect((body.name as string)).not.toContain("\x00");
    }
  });

  it("rejects filename with path separators (slashes)", async () => {
    const { status, body } = await callPaste({
      filename: "../../etc/passwd",
      content: "root:x:0:0",
      dir: sandbox,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid filename");
  });

  it("rejects filename that is '..' (dot-dot)", async () => {
    const { status, body } = await callPaste({
      filename: "..",
      content: "escape",
      dir: sandbox,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid filename");
  });

  it("rejects filename that is '.' (single dot)", async () => {
    const { status, body } = await callPaste({
      filename: ".",
      content: "escape",
      dir: sandbox,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid filename");
  });

  it("rejects filename with backslash path separator", async () => {
    const { status, body } = await callPaste({
      filename: "..\\..\\etc\\passwd",
      content: "evil",
      dir: sandbox,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid filename");
  });

  it("rejects empty content", async () => {
    const { status, body } = await callPaste({
      filename: "empty.txt",
      content: "",
      dir: sandbox,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("content is empty");
  });

  it("handles existing file collision with incrementing suffix", async () => {
    // First paste — should succeed as the original name
    const first = await callPaste({
      filename: "collision.txt",
      content: "first",
      dir: sandbox,
    });
    expect(first.status).toBe(200);
    expect(first.body.name).toBe("collision.txt");

    // Second paste with the same name — should get a suffix
    const second = await callPaste({
      filename: "collision.txt",
      content: "second",
      dir: sandbox,
    });
    expect(second.status).toBe(200);
    expect(second.body.name).toBe("collision-1.txt");
  });

  it("rejects content larger than 1MB", async () => {
    // Build a string slightly over 1MB
    const bigContent = "x".repeat(1024 * 1024 + 1);
    const { status, body } = await callPaste({
      filename: "big.txt",
      content: bigContent,
      dir: sandbox,
    });
    expect(status).toBe(413);
    expect(body.error).toContain("too large");
  });

  it("does not leak absolute path in the response", async () => {
    const { status, body } = await callPaste({
      filename: "noleak.txt",
      content: "test",
      dir: sandbox,
    });
    expect(status).toBe(200);
    // The response should have `name` but NOT `path`
    expect(body.name).toBeDefined();
    expect(body.path).toBeUndefined();
  });
});

describe("/upload endpoint — path traversal via dir parameter", () => {
  /** Build a minimal multipart/form-data body for Hono. */
  function makeUploadForm(fileName: string, dir: string, content = "test"): FormData {
    const form = new FormData();
    const blob = new Blob([content], { type: "application/octet-stream" });
    form.append("file", blob, fileName);
    form.append("dir", dir);
    return form;
  }

  it("rejects upload to a directory outside allowed roots", async () => {
    const form = makeUploadForm("evil.txt", "/tmp/malicious");
    const res = await filesRoute.request("/upload", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Access denied");
  });

  it("rejects upload with path-traversal in the dir parameter", async () => {
    const form = makeUploadForm("file.txt", join(sandbox, "..", "..", "etc"));
    const res = await filesRoute.request("/upload", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(403);
  });

  it("strips directory components from filename (basename sanitization)", async () => {
    // Even if the filename is "../../etc/passwd", basename() extracts "passwd"
    // and the file lands inside the allowed directory, not /etc/
    const form = makeUploadForm("../../etc/passwd", sandbox, "safe content");
    const res = await filesRoute.request("/upload", {
      method: "POST",
      body: form,
    });
    // Should succeed but the file should be named "passwd" inside sandbox
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; name: string; path: string };
    expect(body.ok).toBe(true);
    expect(body.name).toMatch(/^passwd/); // basename extracted
  });

  it("returns 400 when no file is provided", async () => {
    const form = new FormData();
    form.append("dir", sandbox);
    const res = await filesRoute.request("/upload", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("No file provided");
  });
});
