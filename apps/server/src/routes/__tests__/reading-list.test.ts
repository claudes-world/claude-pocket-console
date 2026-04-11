import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

/**
 * Tests for the reading-list CRUD endpoints.
 *
 * Strategy:
 *   - Mock `../db.js` to use an in-memory SQLite database so tests are hermetic.
 *   - Mock `../lib/path-allowed.js` to approve a test-controlled allowlist.
 *   - Mock `../lib/get-user-id.js` to control authentication per test.
 *   - Drive the route via Hono's `app.request()` — no listening server, no ports.
 */

// In-memory database for tests, injected via the mocked db module.
const testDb = new Database(":memory:");
testDb.pragma("journal_mode = WAL");
testDb.exec(`
  CREATE TABLE IF NOT EXISTS reading_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    UNIQUE(user_id, path)
  );
`);

// Mutable test state for auth
let mockUserId: string | null = "test-user-123";

vi.mock("../../db.js", () => ({
  db: testDb,
}));

vi.mock("../../lib/get-user-id.js", () => ({
  getUserId: () => mockUserId,
}));

vi.mock("../../lib/path-allowed.js", () => ({
  ALLOWED_FILE_ROOTS: [
    "/home/claude/claudes-world",
    "/home/claude/code",
    "/home/claude/bin",
    "/home/claude/.claude",
    "/home/claude/claudes-world/.claude",
  ],
  isPathAllowed: async (candidate: string, _roots: string[]) => {
    return (
      candidate.startsWith("/home/claude/code/") ||
      candidate.startsWith("/home/claude/claudes-world/") ||
      candidate === "/home/claude/code" ||
      candidate === "/home/claude/claudes-world"
    );
  },
}));

// Import AFTER vi.mock so reading-list.ts picks up the mocked modules.
const { readingListRoute } = await import("../reading-list.js");

function req(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  return readingListRoute.request(path, opts);
}

beforeEach(() => {
  // Reset auth to authenticated user
  mockUserId = "test-user-123";
  // Clear reading_list table between tests
  testDb.exec("DELETE FROM reading_list");
});

describe("POST /save", () => {
  it("saves a new item and returns ok + id", async () => {
    const res = await req("POST", "/save", {
      path: "/home/claude/code/foo.ts",
      title: "My File",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("number");
  });

  it("upserts on duplicate path (returns ok, updates title)", async () => {
    // First save
    await req("POST", "/save", {
      path: "/home/claude/code/bar.ts",
      title: "Original Title",
    });

    // Second save — same path, new title
    const res = await req("POST", "/save", {
      path: "/home/claude/code/bar.ts",
      title: "Updated Title",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify only one row exists
    const rows = testDb.prepare(
      "SELECT * FROM reading_list WHERE user_id = ? AND path = ?"
    ).all("test-user-123", "/home/claude/code/bar.ts");
    expect(rows.length).toBe(1);
    expect((rows[0] as any).title).toBe("Updated Title");
  });

  it("derives title from basename when not provided", async () => {
    await req("POST", "/save", {
      path: "/home/claude/code/some/deep/file.ts",
    });
    const row = testDb.prepare(
      "SELECT title FROM reading_list WHERE user_id = ? AND path = ?"
    ).get("test-user-123", "/home/claude/code/some/deep/file.ts") as any;
    expect(row.title).toBe("file.ts");
  });



  it("normalizes equivalent path variants to one record", async () => {
    await req("POST", "/save", {
      path: "/home/claude/code/folder/../file.ts",
      title: "First",
    });

    await req("POST", "/save", {
      path: "/home/claude/code/file.ts",
      title: "Second",
    });

    const rows = testDb.prepare(
      "SELECT * FROM reading_list WHERE user_id = ? AND path = ?"
    ).all("test-user-123", "/home/claude/code/file.ts");

    expect(rows.length).toBe(1);
    expect((rows[0] as any).title).toBe("Second");
  });

  it("preserves custom title when re-saving without title", async () => {
    await req("POST", "/save", {
      path: "/home/claude/code/custom.ts",
      title: "Custom Title",
    });

    await req("POST", "/save", {
      path: "/home/claude/code/custom.ts",
    });

    const row = testDb.prepare(
      "SELECT title FROM reading_list WHERE user_id = ? AND path = ?"
    ).get("test-user-123", "/home/claude/code/custom.ts") as any;

    expect(row.title).toBe("Custom Title");
  });
  it("rejects unauthenticated requests with 401", async () => {
    mockUserId = null;
    const res = await req("POST", "/save", {
      path: "/home/claude/code/foo.ts",
    });
    expect(res.status).toBe(401);
  });

  it("rejects missing path with 400", async () => {
    const res = await req("POST", "/save", {});
    expect(res.status).toBe(400);
  });

  it("rejects disallowed path with 403", async () => {
    const res = await req("POST", "/save", {
      path: "/etc/passwd",
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /list", () => {
  it("lists items ordered by created_at DESC", async () => {
    // Insert two items with controlled timestamps
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title, created_at) VALUES (?, ?, ?, ?)"
    ).run("test-user-123", "/home/claude/code/a.ts", "A", 1000);
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title, created_at) VALUES (?, ?, ?, ?)"
    ).run("test-user-123", "/home/claude/code/b.ts", "B", 2000);

    const res = await req("GET", "/list");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(2);
    // B is newer, should come first
    expect(body.items[0].title).toBe("B");
    expect(body.items[1].title).toBe("A");
    // Each item has expected fields
    expect(body.items[0]).toHaveProperty("id");
    expect(body.items[0]).toHaveProperty("path");
    expect(body.items[0]).toHaveProperty("title");
    expect(body.items[0]).toHaveProperty("created_at");
  });

  it("returns empty array when no items", async () => {
    const res = await req("GET", "/list");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it("only returns items for the authenticated user", async () => {
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title) VALUES (?, ?, ?)"
    ).run("test-user-123", "/home/claude/code/mine.ts", "Mine");
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title) VALUES (?, ?, ?)"
    ).run("other-user-456", "/home/claude/code/theirs.ts", "Theirs");

    const res = await req("GET", "/list");
    const body = await res.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].title).toBe("Mine");
  });

  it("rejects unauthenticated requests with 401", async () => {
    mockUserId = null;
    const res = await req("GET", "/list");
    expect(res.status).toBe(401);
  });
});

describe("GET /check", () => {
  it("returns correct saved map for batched paths", async () => {
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title) VALUES (?, ?, ?)"
    ).run("test-user-123", "/home/claude/code/saved.ts", "Saved");

    const res = await req(
      "GET",
      "/check?paths=/home/claude/code/saved.ts,/home/claude/code/not-saved.ts"
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved["/home/claude/code/saved.ts"]).toBe(true);
    expect(body.saved["/home/claude/code/not-saved.ts"]).toBe(false);
  });



  it("normalizes incoming paths before checking", async () => {
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title) VALUES (?, ?, ?)"
    ).run("test-user-123", "/home/claude/code/saved.ts", "Saved");

    const res = await req(
      "GET",
      "/check?paths=/home/claude/code/dir/../saved.ts"
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved["/home/claude/code/saved.ts"]).toBe(true);
  });
  it("returns empty map when no paths param", async () => {
    const res = await req("GET", "/check");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toEqual({});
  });

  it("rejects more than 256 paths with 413", async () => {
    const paths = Array.from({ length: 257 }, (_, i) => `/home/claude/code/f${i}.ts`).join(",");
    const res = await req("GET", `/check?paths=${paths}`);
    expect(res.status).toBe(413);
  });

  it("rejects unauthenticated requests with 401", async () => {
    mockUserId = null;
    const res = await req("GET", "/check?paths=/home/claude/code/foo.ts");
    expect(res.status).toBe(401);
  });
});

describe("POST /delete", () => {
  it("deletes by id", async () => {
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title) VALUES (?, ?, ?)"
    ).run("test-user-123", "/home/claude/code/del.ts", "Del");
    const row = testDb.prepare(
      "SELECT id FROM reading_list WHERE user_id = ? AND path = ?"
    ).get("test-user-123", "/home/claude/code/del.ts") as { id: number };

    const res = await req("POST", "/delete", { id: row.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify it's actually deleted
    const check = testDb.prepare(
      "SELECT id FROM reading_list WHERE id = ?"
    ).get(row.id);
    expect(check).toBeUndefined();
  });

  it("deletes by path", async () => {
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title) VALUES (?, ?, ?)"
    ).run("test-user-123", "/home/claude/code/del2.ts", "Del2");

    const res = await req("POST", "/delete", { path: "/home/claude/code/del2.ts" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });



  it("normalizes path before deleting", async () => {
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title) VALUES (?, ?, ?)"
    ).run("test-user-123", "/home/claude/code/norm.ts", "Norm");

    const res = await req("POST", "/delete", { path: "/home/claude/code/dir/../norm.ts" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
  it("returns 404 when deleting someone else's item (by id)", async () => {
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title) VALUES (?, ?, ?)"
    ).run("other-user-456", "/home/claude/code/theirs.ts", "Theirs");
    const row = testDb.prepare(
      "SELECT id FROM reading_list WHERE user_id = ? AND path = ?"
    ).get("other-user-456", "/home/claude/code/theirs.ts") as { id: number };

    const res = await req("POST", "/delete", { id: row.id });
    expect(res.status).toBe(404);

    // Verify it was NOT deleted
    const check = testDb.prepare(
      "SELECT id FROM reading_list WHERE id = ?"
    ).get(row.id);
    expect(check).toBeDefined();
  });

  it("returns 404 when deleting someone else's item (by path)", async () => {
    testDb.prepare(
      "INSERT INTO reading_list (user_id, path, title) VALUES (?, ?, ?)"
    ).run("other-user-456", "/home/claude/code/theirs2.ts", "Theirs2");

    const res = await req("POST", "/delete", { path: "/home/claude/code/theirs2.ts" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when neither id nor path provided", async () => {
    const res = await req("POST", "/delete", {});
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests with 401", async () => {
    mockUserId = null;
    const res = await req("POST", "/delete", { id: 1 });
    expect(res.status).toBe(401);
  });
});
