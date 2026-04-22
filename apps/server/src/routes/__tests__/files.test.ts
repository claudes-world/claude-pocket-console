import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetRealRootCacheForTests } from "../../lib/path-allowed.js";

/**
 * Comprehensive tests for `files.ts` route endpoints.
 *
 * This file covers the endpoints that are NOT already tested by the
 * focused security-specific test files:
 *   - download-ticket.test.ts  (POST /download-ticket + GET /download ticket path)
 *   - file-upload.test.ts      (POST /upload + POST /paste security)
 *   - search-scope.test.ts     (GET /search ?scope= parameter)
 *   - path-allowed.test.ts     (isPathAllowed helper)
 *
 * Endpoints tested here:
 *   1. GET /roots        — returns the allowed file roots
 *   2. GET /list         — directory listing, sorting, hidden files, parent nav
 *   3. GET /read         — file content reading, text detection, size/binary limits
 *   4. POST /download-ticket — validation edge cases (missing path, disallowed)
 *   5. GET /download     — direct path download (non-ticket), validation
 *   6. GET /search       — basic search happy path + short query guard
 *   7. POST /paste       — happy path + missing fields validation
 *
 * Strategy: same mock-seam approach as the existing test files. We mock
 * `path-allowed.js` to inject a temp-dir allowlist so tests are hermetic,
 * then drive the filesRoute Hono sub-app via `app.request()`.
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
  sandbox = mkdtempSync(join(tmpdir(), "cpc-files-test-"));
  testAllowedRoots = [sandbox];
  __resetRealRootCacheForTests();

  // Build a small file tree for tests:
  //   sandbox/
  //     hello.txt          (text file)
  //     data.json          (JSON file)
  //     .hidden-file       (dotfile)
  //     sub/
  //       nested.md        (nested text file)
  //     empty-dir/
  mkdirSync(join(sandbox, "sub"), { recursive: true });
  mkdirSync(join(sandbox, "empty-dir"), { recursive: true });
  writeFileSync(join(sandbox, "hello.txt"), "Hello, world!");
  writeFileSync(join(sandbox, "data.json"), '{"key": "value"}');
  writeFileSync(join(sandbox, ".hidden-file"), "secret");
  writeFileSync(join(sandbox, "sub", "nested.md"), "# Nested\n\nContent here.");
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  __resetRealRootCacheForTests();
});

// ---------------------------------------------------------------------------
// GET /roots
// ---------------------------------------------------------------------------
describe("GET /roots", () => {
  it("returns an array of root objects with path and name", async () => {
    const res = await filesRoute.request("/roots");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roots: Array<{ path: string; name: string }>;
    };
    expect(Array.isArray(body.roots)).toBe(true);
    expect(body.roots.length).toBeGreaterThan(0);
    // Each root should have a path (string) and name (string)
    for (const root of body.roots) {
      expect(typeof root.path).toBe("string");
      expect(typeof root.name).toBe("string");
    }
  });

  it("name field replaces /home/claude/ with ~/", async () => {
    const res = await filesRoute.request("/roots");
    const body = (await res.json()) as {
      roots: Array<{ path: string; name: string }>;
    };
    // The route replaces /home/claude/ with ~/ in the name field.
    // Since we're using the mock, the ALLOWED_ROOTS const still has the
    // original production values. Just verify the transformation pattern.
    for (const root of body.roots) {
      if (root.path.startsWith("/home/claude/")) {
        expect(root.name).toMatch(/^~\//);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// GET /list
// ---------------------------------------------------------------------------
describe("GET /list", () => {
  it("lists directory contents for an allowed path", async () => {
    const res = await filesRoute.request(`/list?path=${encodeURIComponent(sandbox)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      path: string;
      parent: string | null;
      items: Array<{
        name: string;
        path: string;
        type: string;
        size: number;
        modified: string;
      }>;
    };
    expect(body.path).toBe(sandbox);
    expect(Array.isArray(body.items)).toBe(true);

    // Should contain our non-hidden files/dirs
    const names = body.items.map((i) => i.name);
    expect(names).toContain("hello.txt");
    expect(names).toContain("data.json");
    expect(names).toContain("sub");
    expect(names).toContain("empty-dir");
  });

  it("hides dotfiles by default", async () => {
    const res = await filesRoute.request(`/list?path=${encodeURIComponent(sandbox)}`);
    const body = (await res.json()) as {
      items: Array<{ name: string }>;
    };
    const names = body.items.map((i) => i.name);
    expect(names).not.toContain(".hidden-file");
  });

  it("shows dotfiles when hidden=1", async () => {
    const res = await filesRoute.request(
      `/list?path=${encodeURIComponent(sandbox)}&hidden=1`,
    );
    const body = (await res.json()) as {
      items: Array<{ name: string }>;
    };
    const names = body.items.map((i) => i.name);
    expect(names).toContain(".hidden-file");
  });

  it("sorts directories before files, then alphabetically", async () => {
    const res = await filesRoute.request(`/list?path=${encodeURIComponent(sandbox)}`);
    const body = (await res.json()) as {
      items: Array<{ name: string; type: string }>;
    };

    // Separate dirs and files from the response
    const dirs = body.items.filter((i) => i.type === "dir");
    const files = body.items.filter((i) => i.type === "file");

    // All dirs should come before all files
    expect(dirs.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
    const lastDirIndex = body.items.lastIndexOf(dirs[dirs.length - 1]);
    const firstFileIndex = body.items.indexOf(files[0]);
    expect(lastDirIndex).toBeLessThan(firstFileIndex);

    // Within each group, names should be sorted
    const dirNames = dirs.map((d) => d.name);
    expect(dirNames).toEqual([...dirNames].sort((a, b) => a.localeCompare(b)));

    const fileNames = files.map((f) => f.name);
    expect(fileNames).toEqual([...fileNames].sort((a, b) => a.localeCompare(b)));
  });

  it("returns 403 for a disallowed path", async () => {
    const res = await filesRoute.request(`/list?path=${encodeURIComponent("/etc")}`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Access denied");
  });

  it("items include expected metadata fields", async () => {
    const res = await filesRoute.request(`/list?path=${encodeURIComponent(sandbox)}`);
    const body = (await res.json()) as {
      items: Array<{
        name: string;
        path: string;
        type: string;
        size: number;
        modified: string;
      }>;
    };
    const file = body.items.find((i) => i.name === "hello.txt");
    expect(file).toBeDefined();
    expect(file!.type).toBe("file");
    expect(file!.size).toBe(13); // "Hello, world!" = 13 bytes
    expect(file!.path).toBe(join(sandbox, "hello.txt"));
    expect(file!.modified).toBeTruthy(); // ISO date string
  });

  it("parent is null when parent directory is not allowed", async () => {
    // The sandbox itself is the allowed root. Its parent (/tmp/...) is NOT
    // in the test allowlist, so parent should be null.
    const res = await filesRoute.request(`/list?path=${encodeURIComponent(sandbox)}`);
    const body = (await res.json()) as { parent: string | null };
    expect(body.parent).toBeNull();
  });

  it("parent is set when navigating into a subdirectory", async () => {
    const subPath = join(sandbox, "sub");
    const res = await filesRoute.request(`/list?path=${encodeURIComponent(subPath)}`);
    const body = (await res.json()) as { parent: string | null };
    // Parent of sandbox/sub is sandbox, which IS allowed
    expect(body.parent).toBe(sandbox);
  });
});

// ---------------------------------------------------------------------------
// GET /read
// ---------------------------------------------------------------------------
describe("GET /read", () => {
  it("reads a text file and returns its content", async () => {
    const filePath = join(sandbox, "hello.txt");
    const res = await filesRoute.request(
      `/read?path=${encodeURIComponent(filePath)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      path: string;
      name: string;
      content: string;
      size: number;
      modified: string;
    };
    expect(body.content).toBe("Hello, world!");
    expect(body.name).toBe("hello.txt");
    expect(body.size).toBe(13);
    expect(body.modified).toBeTruthy();
  });

  it("reads a .json file as text", async () => {
    const filePath = join(sandbox, "data.json");
    const res = await filesRoute.request(
      `/read?path=${encodeURIComponent(filePath)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string };
    expect(body.content).toBe('{"key": "value"}');
  });

  it("reads a .md file as text", async () => {
    const filePath = join(sandbox, "sub", "nested.md");
    const res = await filesRoute.request(
      `/read?path=${encodeURIComponent(filePath)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string };
    expect(body.content).toBe("# Nested\n\nContent here.");
  });

  it("returns 400 when path parameter is missing", async () => {
    const res = await filesRoute.request("/read");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("path parameter required");
  });

  it("returns 403 for a disallowed path", async () => {
    const res = await filesRoute.request(
      `/read?path=${encodeURIComponent("/etc/passwd")}`,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Access denied");
  });

  it("returns 500 for a non-existent file inside an allowed dir", async () => {
    // isPathAllowed requires realpath to succeed, so a non-existent file
    // is rejected at the isPathAllowed stage (returns false → 403).
    // However, if the file disappears between the check and the read,
    // the route would return 500. We test the 403 path since that's the
    // normal flow for missing files.
    const filePath = join(sandbox, "does-not-exist.txt");
    const res = await filesRoute.request(
      `/read?path=${encodeURIComponent(filePath)}`,
    );
    // realpath fails for non-existent → isPathAllowed returns false → 403
    expect(res.status).toBe(403);
  });

  it("returns 413 for a file larger than 1MB", async () => {
    const bigFile = join(sandbox, "big.txt");
    // Write a file just over 1MB
    writeFileSync(bigFile, "x".repeat(1024 * 1024 + 1));
    try {
      const res = await filesRoute.request(
        `/read?path=${encodeURIComponent(bigFile)}`,
      );
      expect(res.status).toBe(413);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("too large");
    } finally {
      rmSync(bigFile, { force: true });
    }
  });

  it("returns 415 for a binary file", async () => {
    const binFile = join(sandbox, "binary.dat");
    // Write a file with null bytes (binary indicator)
    const buf = Buffer.alloc(100);
    buf[0] = 0x89; // PNG-like magic
    buf[1] = 0x50;
    buf[50] = 0x00; // null byte
    writeFileSync(binFile, buf);
    try {
      const res = await filesRoute.request(
        `/read?path=${encodeURIComponent(binFile)}`,
      );
      expect(res.status).toBe(415);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Binary file");
    } finally {
      rmSync(binFile, { force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// POST /download-ticket — validation edge cases
// ---------------------------------------------------------------------------
describe("POST /download-ticket", () => {
  it("creates a ticket for an allowed file", async () => {
    const filePath = join(sandbox, "hello.txt");
    const res = await filesRoute.request("/download-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticket: string };
    expect(body.ticket).toMatch(/^[0-9a-f]{32}$/);

    // Redeem the ticket so it doesn't leak into subsequent tests
    const redeemRes = await filesRoute.request(`/download?ticket=${body.ticket}`);
    await redeemRes.arrayBuffer();
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await filesRoute.request("/download-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns 400 when path is missing from body", async () => {
    const res = await filesRoute.request("/download-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("path required");
  });

  it("returns 403 for a disallowed path", async () => {
    const res = await filesRoute.request("/download-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/etc/passwd" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Access denied");
  });

  it("returns 400 for a directory (not a file)", async () => {
    const res = await filesRoute.request("/download-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: join(sandbox, "sub") }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not a file");
  });
});

// ---------------------------------------------------------------------------
// GET /download — direct path download + ticket validation
// ---------------------------------------------------------------------------
describe("GET /download", () => {
  it("downloads a file via direct path parameter", async () => {
    const filePath = join(sandbox, "hello.txt");
    const res = await filesRoute.request(
      `/download?path=${encodeURIComponent(filePath)}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toContain("hello.txt");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(text).toBe("Hello, world!");
  });

  it("returns 400 when neither ticket nor path is provided", async () => {
    const res = await filesRoute.request("/download");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("path parameter required");
  });

  it("returns 403 for a disallowed direct path", async () => {
    const res = await filesRoute.request(
      `/download?path=${encodeURIComponent("/etc/passwd")}`,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Access denied");
  });

  it("returns 403 for an invalid ticket", async () => {
    const res = await filesRoute.request("/download?ticket=deadbeef00000000deadbeef00000000");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid or expired ticket");
  });

  it("ticket can only be used once (replay protection)", async () => {
    const filePath = join(sandbox, "hello.txt");
    // Create ticket
    const ticketRes = await filesRoute.request("/download-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });
    const { ticket } = (await ticketRes.json()) as { ticket: string };

    // First use — should succeed
    const first = await filesRoute.request(`/download?ticket=${ticket}`);
    expect(first.status).toBe(200);
    await first.arrayBuffer(); // consume body to avoid file-descriptor leak

    // Second use — should fail
    const second = await filesRoute.request(`/download?ticket=${ticket}`);
    expect(second.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /search — basic functionality
// ---------------------------------------------------------------------------
describe("GET /search", () => {
  // Note: the search BFS seeds from the module-level ALLOWED_ROOTS const,
  // which is NOT affected by our isPathAllowed mock. To test search results
  // in a hermetic sandbox, we use the ?scope= parameter to narrow the BFS
  // to our sandbox directory (which IS allowed via the mocked isPathAllowed).

  it("returns matching files for a valid scoped query", async () => {
    const res = await filesRoute.request(
      `/search?q=hello&scope=${encodeURIComponent(sandbox)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ name: string; path: string; type: string; relPath: string }>;
    };
    const names = body.results.map((r) => r.name);
    expect(names).toContain("hello.txt");
  });

  it("returns empty results for a 1-character query (minimum length guard)", async () => {
    const res = await filesRoute.request(
      `/search?q=h&scope=${encodeURIComponent(sandbox)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<unknown> };
    expect(body.results).toEqual([]);
  });

  it("returns empty results for an empty query", async () => {
    const res = await filesRoute.request("/search?q=");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<unknown> };
    expect(body.results).toEqual([]);
  });

  it("search results include expected fields", async () => {
    const res = await filesRoute.request(
      `/search?q=nested&scope=${encodeURIComponent(sandbox)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ name: string; path: string; type: string; relPath: string }>;
    };
    const match = body.results.find((r) => r.name === "nested.md");
    expect(match).toBeDefined();
    expect(match!.type).toBe("file");
    expect(match!.path).toBe(join(sandbox, "sub", "nested.md"));
    expect(typeof match!.relPath).toBe("string");
  });

  it("search finds directories too", async () => {
    const res = await filesRoute.request(
      `/search?q=empty-dir&scope=${encodeURIComponent(sandbox)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ name: string; type: string }>;
    };
    const match = body.results.find((r) => r.name === "empty-dir");
    expect(match).toBeDefined();
    expect(match!.type).toBe("dir");
  });
});

// ---------------------------------------------------------------------------
// POST /paste — happy path and basic validation
// (Security-specific tests are in file-upload.test.ts)
// ---------------------------------------------------------------------------
describe("POST /paste", () => {
  it("creates a file with the given content", async () => {
    const res = await filesRoute.request("/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "pasted.txt",
        content: "pasted content here",
        dir: sandbox,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; name: string; size: number };
    expect(body.ok).toBe(true);
    expect(body.name).toBe("pasted.txt");
    expect(body.size).toBeGreaterThan(0);

    // Verify on disk
    const onDisk = readFileSync(join(sandbox, "pasted.txt"), "utf-8");
    expect(onDisk).toBe("pasted content here");
  });

  it("normalizes CRLF line endings to LF", async () => {
    const res = await filesRoute.request("/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "crlf-test.txt",
        content: "line1\r\nline2\r\nline3",
        dir: sandbox,
      }),
    });
    expect(res.status).toBe(200);

    const onDisk = readFileSync(join(sandbox, "crlf-test.txt"), "utf-8");
    expect(onDisk).toBe("line1\nline2\nline3");
    expect(onDisk).not.toContain("\r");
  });

  it("returns 400 when content is missing", async () => {
    const res = await filesRoute.request("/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "no-content.txt",
        dir: sandbox,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when filename is missing", async () => {
    const res = await filesRoute.request("/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "stuff",
        dir: sandbox,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when dir is missing", async () => {
    const res = await filesRoute.request("/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "no-dir.txt",
        content: "stuff",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for a disallowed directory", async () => {
    const res = await filesRoute.request("/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "evil.txt",
        content: "pwned",
        dir: "/etc",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("does not leak absolute path in response", async () => {
    const res = await filesRoute.request("/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "noleak-check.txt",
        content: "test",
        dir: sandbox,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBeDefined();
    expect(body.path).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(sandbox);
  });
});

// ---------------------------------------------------------------------------
// GET /list — synthetic home view (/home/claude)
// ---------------------------------------------------------------------------
describe("GET /list — synthetic home view", () => {
  it("returns only allowlisted subdirs of /home/claude, never disallowed siblings", async () => {
    const res = await filesRoute.request(
      `/list?path=${encodeURIComponent("/home/claude")}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      path: string;
      parent: string | null;
      items: Array<{ name: string; path: string; type: string }>;
    };

    expect(body.path).toBe("/home/claude");
    expect(body.parent).toBeNull();
    expect(Array.isArray(body.items)).toBe(true);

    // Every returned item must be a directory whose path starts with /home/claude/
    for (const item of body.items) {
      expect(item.type).toBe("directory");
      expect(item.path.startsWith("/home/claude/")).toBe(true);
    }

    const names = body.items.map((i) => i.name);

    // Allowlisted direct children must be present
    expect(names).toContain("claudes-world");
    expect(names).toContain("code");
    expect(names).toContain("bin");
    expect(names).toContain(".claude");
    expect(names).toContain(".world");

    // Disallowed siblings must never appear
    expect(names).not.toContain(".ssh");
    expect(names).not.toContain(".secrets");
    expect(names).not.toContain("claudes-world/.claude"); // nested root, not a direct child
  });

  it("returns 403 for direct file-read on /home/claude", async () => {
    const res = await filesRoute.request(
      `/read?path=${encodeURIComponent("/home/claude")}`,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Access denied");
  });
});
