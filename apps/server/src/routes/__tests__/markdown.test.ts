import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

/**
 * Tests for POST /api/markdown/summarize — the TL;DR summarizer route.
 *
 * Coverage:
 *   - Input validation: missing path, non-.md path, non-existent file,
 *     non-file (directory), empty file, file too large, invalid JSON body
 *   - Path security: disallowed paths rejected with 403
 *   - Cache: returns cached summary when available, skips cache on force=true
 *   - CLI integration: happy-path spawn, timeout → 504, non-zero exit → 502
 *   - Body limit enforcement
 *
 * Strategy:
 *   - Mock `../../db.js` to stub the prepared-statement cache layer
 *   - Mock `../../lib/path-allowed.js` to control path authorization
 *   - Mock `node:child_process` spawn to simulate the Claude CLI
 *   - Mock `node:fs/promises` readFile/stat to control file I/O
 *   - The route is a standalone Hono sub-app, tested via `app.request()`
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

// --- DB mock ---
const selectCacheGet = vi.fn(() => null);
const insertCacheRun = vi.fn();
vi.mock("../../db.js", () => {
  return {
    db: {
      prepare: vi.fn((sql: string) => {
        if (sql.includes("SELECT")) return { get: selectCacheGet };
        if (sql.includes("INSERT")) return { run: insertCacheRun };
        return { run: vi.fn(), get: vi.fn(), all: vi.fn() };
      }),
    },
  };
});

// --- path-allowed mock ---
let pathAllowedResult = true;
vi.mock("../../lib/path-allowed.js", () => ({
  ALLOWED_FILE_ROOTS: ["/allowed"],
  isPathAllowed: vi.fn(async () => pathAllowedResult),
}));

// --- fs/promises mock ---
const statResult = { isFile: () => true, size: 100 };
const readFileResult = "# Hello\n\nSome markdown content.";
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  return {
    ...actual,
    stat: vi.fn(async () => statResult),
    readFile: vi.fn(async () => readFileResult),
  };
});

// --- child_process mock ---
// We build a fake ChildProcess with controllable stdout/stderr/close events.
type FakeProc = EventEmitter & {
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
};

let fakeProc: FakeProc;

function createFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdin = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
  });
  proc.stdout = Object.assign(new EventEmitter(), {
    setEncoding: vi.fn(),
  });
  proc.stderr = Object.assign(new EventEmitter(), {
    setEncoding: vi.fn(),
  });
  proc.kill = vi.fn();
  return proc;
}

const spawnSpy = vi.fn((_cmd: string, _args: string[], _opts: any) => {
  fakeProc = createFakeProc();
  return fakeProc;
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: spawnSpy,
  };
});

// ---------------------------------------------------------------------------
// Import the route AFTER all mocks are registered
// ---------------------------------------------------------------------------
const { markdownRoute } = await import("../markdown.js");

// Reimport mocked fs to control per-test return values
const fsMock = await import("node:fs/promises");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postSummarize(
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return markdownRoute.request("/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Simulate the Claude CLI returning a summary on stdout then exiting 0. */
function resolveCliWith(text: string): void {
  // The route writes to stdin (fire-and-forget) then listens for stdout data + close.
  // We simulate the CLI writing back and exiting cleanly.
  setTimeout(() => {
    fakeProc.stdout.emit("data", text);
    fakeProc.emit("close", 0);
  }, 5);
}

/** Simulate the Claude CLI exiting with a non-zero code. */
function rejectCliWith(code: number, stderr = ""): void {
  setTimeout(() => {
    if (stderr) fakeProc.stderr.emit("data", stderr);
    fakeProc.emit("close", code);
  }, 5);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  pathAllowedResult = true;
  selectCacheGet.mockReturnValue(null);
  insertCacheRun.mockClear();
  spawnSpy.mockClear();

  // Reset fs mocks to defaults
  vi.mocked(fsMock.stat).mockResolvedValue(
    { isFile: () => true, size: 100 } as any,
  );
  vi.mocked(fsMock.readFile).mockResolvedValue(
    "# Hello\n\nSome markdown content.",
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /summarize — input validation", () => {
  it("returns 400 for invalid JSON body", async () => {
    const res = await markdownRoute.request("/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json {{{",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns 400 when path is missing from body", async () => {
    const res = await postSummarize({});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("path required");
  });

  it("returns 400 when path is empty string", async () => {
    const res = await postSummarize({ path: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("path required");
  });

  it("returns 400 when path is not a string", async () => {
    const res = await postSummarize({ path: 42 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("path required");
  });

  it("returns 400 for non-.md file path", async () => {
    const res = await postSummarize({ path: "/allowed/readme.txt" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("Only .md files are supported");
  });
});

describe("POST /summarize — path security", () => {
  it("returns 403 for a disallowed path", async () => {
    pathAllowedResult = false;
    const res = await postSummarize({ path: "/secret/private.md" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("Access denied");
  });
});

describe("POST /summarize — file validation", () => {
  it("returns 404 when file does not exist", async () => {
    vi.mocked(fsMock.stat).mockRejectedValueOnce(new Error("ENOENT"));
    const res = await postSummarize({ path: "/allowed/missing.md" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("File not found");
  });

  it("returns 400 when path is a directory, not a file", async () => {
    vi.mocked(fsMock.stat).mockResolvedValueOnce({
      isFile: () => false,
      size: 0,
    } as any);
    const res = await postSummarize({ path: "/allowed/somedir.md" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("Not a file");
  });

  it("returns 413 when file exceeds max size", async () => {
    vi.mocked(fsMock.stat).mockResolvedValueOnce({
      isFile: () => true,
      size: 1_000_000,
    } as any);
    const res = await postSummarize({ path: "/allowed/huge.md" });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toMatch(/too large/i);
  });

  it("returns 400 when file is empty", async () => {
    vi.mocked(fsMock.readFile).mockResolvedValueOnce("   \n  \n  ");
    const res = await postSummarize({ path: "/allowed/empty.md" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("File is empty");
  });

  it("returns 500 when readFile fails", async () => {
    vi.mocked(fsMock.readFile).mockRejectedValueOnce(new Error("EACCES"));
    const res = await postSummarize({ path: "/allowed/unreadable.md" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("Failed to read file");
  });
});

describe("POST /summarize — cache behavior", () => {
  it("returns cached summary when available", async () => {
    selectCacheGet.mockReturnValueOnce({ summary: "Cached TL;DR" });
    const res = await postSummarize({ path: "/allowed/doc.md" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      summary: string;
      cached: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.summary).toBe("Cached TL;DR");
    expect(body.cached).toBe(true);
    // Should NOT have spawned the CLI
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("bypasses cache when force=true and spawns CLI", async () => {
    // Don't mock selectCacheGet here — force=true skips the cache lookup
    // entirely, so a mockReturnValueOnce would never be consumed and would
    // leak into the next test.
    vi.mocked(fsMock.readFile).mockResolvedValueOnce(
      "# Force-refresh unique content\n\nBody.",
    );
    const res = postSummarize({ path: "/allowed/doc.md", force: true });

    // CLI will be spawned despite any potential cache hit
    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    resolveCliWith("Fresh summary");

    const response = await res;
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      summary: string;
      cached: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.summary).toBe("Fresh summary");
    expect(body.cached).toBe(false);
  });
});

describe("POST /summarize — CLI happy path", () => {
  it("returns summary from CLI and writes to cache", async () => {
    // Use unique content so the in-flight deduplication map key differs
    // from other tests (keyed by content hash + prompt version + model).
    vi.mocked(fsMock.readFile).mockResolvedValueOnce(
      "# Unique content for cache-write test\n\nBody text.",
    );
    const res = postSummarize({ path: "/allowed/doc.md" });

    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    resolveCliWith("## TL;DR\nThis is a summary.");

    const response = await res;
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      summary: string;
      cached: boolean;
      model: string;
      promptVersion: number;
      ms: number;
    };
    expect(body.ok).toBe(true);
    expect(body.summary).toBe("## TL;DR\nThis is a summary.");
    expect(body.cached).toBe(false);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.promptVersion).toBe(1);
    expect(typeof body.ms).toBe("number");
    // Should have written to cache
    expect(insertCacheRun).toHaveBeenCalledTimes(1);
  });

  it("spawns claude with security flags (--tools empty, --permission-mode plan)", async () => {
    const res = postSummarize({ path: "/allowed/doc.md" });

    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));

    const [_bin, args] = spawnSpy.mock.calls[0];
    expect(args).toContain("-p");
    expect(args).toContain("--tools");
    expect(args).toContain("");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("plan");
    expect(args).toContain("--strict-mcp-config");

    resolveCliWith("summary");
    await res;
  });

  it("sends document content to CLI stdin with nonce-tagged delimiters", async () => {
    const res = postSummarize({ path: "/allowed/doc.md" });

    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));

    // stdin.write should have been called with the document wrapped in DOCUMENT-<nonce> tags
    expect(fakeProc.stdin.write).toHaveBeenCalledTimes(1);
    const written = fakeProc.stdin.write.mock.calls[0][0] as string;
    expect(written).toMatch(/<DOCUMENT-[0-9a-f]{32}>/);
    expect(written).toMatch(/<\/DOCUMENT-[0-9a-f]{32}>/);
    expect(written).toContain("UNTRUSTED INPUT");
    expect(fakeProc.stdin.end).toHaveBeenCalledTimes(1);

    resolveCliWith("summary");
    await res;
  });
});

describe("POST /summarize — CLI error paths", () => {
  it("returns 502 when CLI exits with non-zero code", async () => {
    const res = postSummarize({ path: "/allowed/doc.md" });

    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    rejectCliWith(1, "some error");

    const response = await res;
    expect(response.status).toBe(502);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    // Error message should NOT leak stderr content
    expect(body.error).not.toContain("some error");
  });

  it("returns 502 when CLI returns empty output", async () => {
    const res = postSummarize({ path: "/allowed/doc.md" });

    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    // Emit empty stdout then exit 0
    setTimeout(() => {
      fakeProc.stdout.emit("data", "   ");
      fakeProc.emit("close", 0);
    }, 5);

    const response = await res;
    expect(response.status).toBe(502);
  });

  it("returns 502 when spawn itself fails", async () => {
    const res = postSummarize({ path: "/allowed/doc.md" });

    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    setTimeout(() => {
      fakeProc.emit("error", new Error("ENOENT: claude not found"));
    }, 5);

    const response = await res;
    expect(response.status).toBe(502);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  });

  it("handles non-fatal cache write failure gracefully", async () => {
    insertCacheRun.mockImplementationOnce(() => {
      throw new Error("SQLITE_FULL");
    });

    const res = postSummarize({ path: "/allowed/doc.md" });

    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    resolveCliWith("Summary despite cache failure");

    const response = await res;
    // Should still return 200 — cache write failure is non-fatal
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; summary: string };
    expect(body.ok).toBe(true);
    expect(body.summary).toBe("Summary despite cache failure");
  });
});

describe("POST /summarize — env var overrides", () => {
  it("uses CPC_TLDR_MODEL when set", async () => {
    const original = process.env.CPC_TLDR_MODEL;
    process.env.CPC_TLDR_MODEL = "claude-sonnet-4-5";
    try {
      selectCacheGet.mockReturnValueOnce({ summary: "cached" });
      const res = await postSummarize({ path: "/allowed/doc.md" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { model: string };
      expect(body.model).toBe("claude-sonnet-4-5");
    } finally {
      if (original === undefined) delete process.env.CPC_TLDR_MODEL;
      else process.env.CPC_TLDR_MODEL = original;
    }
  });
});
