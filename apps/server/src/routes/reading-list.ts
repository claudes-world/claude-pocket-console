import { Hono } from "hono";
import { basename } from "node:path";
import { db } from "../db.js";
import { getUserId } from "../lib/get-user-id.js";
import { isPathAllowed } from "../lib/path-allowed.js";

const app = new Hono();

// Allowed root directories — same set as files.ts
const ALLOWED_ROOTS = [
  "/home/claude/claudes-world",
  "/home/claude/code",
  "/home/claude/bin",
  "/home/claude/.claude",
  "/home/claude/claudes-world/.claude",
];

// Create reading_list table at module load (same pattern as db.ts for transcripts)
db.exec(`
  CREATE TABLE IF NOT EXISTS reading_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, path)
  );

  CREATE INDEX IF NOT EXISTS idx_reading_list_user
    ON reading_list(user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_reading_list_user_path
    ON reading_list(user_id, path);
`);

// POST /save — save a file to reading list (upsert)
app.post("/save", async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ error: "auth required" }, 401);
  }

  let body: { path?: string; title?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { path, title } = body;
  if (!path || typeof path !== "string") {
    return c.json({ error: "path is required" }, 400);
  }

  if (!(await isPathAllowed(path, ALLOWED_ROOTS))) {
    return c.json({ error: "Access denied" }, 403);
  }

  // Upsert: insert or update title on conflict, returning the id in one query
  const stmt = db.prepare(`
    INSERT INTO reading_list (user_id, path, title)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, path) DO UPDATE SET
      title = COALESCE(excluded.title, reading_list.title)
    RETURNING id
  `);

  const row = stmt.get(userId, path, title ?? basename(path)) as { id: number };

  return c.json({ ok: true, id: row.id });
});

// GET /list — list all reading list items for user
app.get("/list", (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ error: "auth required" }, 401);
  }

  const rows = db.prepare(`
    SELECT id, path, title, created_at
    FROM reading_list
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId) as Array<{ id: number; path: string; title: string | null; created_at: string }>;

  return c.json({ items: rows });
});

// GET /check — batched check which paths are saved
app.get("/check", (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ error: "auth required" }, 401);
  }

  const pathsParam = c.req.query("paths");
  if (!pathsParam) {
    return c.json({ saved: {} });
  }

  const paths = [...new Set(pathsParam.split(",").filter(Boolean))];
  if (paths.length === 0) {
    return c.json({ saved: {} });
  }

  // Cap at 256 paths per request
  if (paths.length > 256) {
    return c.json({ error: "Too many paths (max 256)" }, 413);
  }

  // Query all matching paths for this user in one go
  const placeholders = paths.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT path FROM reading_list
    WHERE user_id = ? AND path IN (${placeholders})
  `).all(userId, ...paths) as Array<{ path: string }>;

  const savedSet = new Set(rows.map((r) => r.path));
  const saved: Record<string, boolean> = {};
  for (const p of paths) {
    saved[p] = savedSet.has(p);
  }

  return c.json({ saved });
});

// DELETE /delete — hard delete a reading list item
app.post("/delete", async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ error: "auth required" }, 401);
  }

  let body: { id?: number; path?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { id, path } = body;

  if (id !== undefined) {
    // Delete by id — ownership enforced in WHERE clause
    const result = db.prepare(
      "DELETE FROM reading_list WHERE id = ? AND user_id = ?"
    ).run(id, userId);

    if (result.changes === 0) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json({ ok: true });
  }

  if (path && typeof path === "string") {
    // Delete by path — ownership enforced in WHERE clause
    const result = db.prepare(
      "DELETE FROM reading_list WHERE path = ? AND user_id = ?"
    ).run(path, userId);

    if (result.changes === 0) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json({ ok: true });
  }

  return c.json({ error: "id or path is required" }, 400);
});

export { app as readingListRoute };
