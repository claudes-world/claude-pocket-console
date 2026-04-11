import { Hono } from "hono";
import { basename, resolve } from "node:path";
import { db } from "../db.js";
import { getUserId } from "../lib/get-user-id.js";
import { ALLOWED_FILE_ROOTS, isPathAllowed } from "../lib/path-allowed.js";

const app = new Hono();

const ALLOWED_ROOTS = [...ALLOWED_FILE_ROOTS];

function normalizePath(path: string): string {
  // Trim before resolve() — otherwise leading/trailing whitespace (e.g. from
  // copy/paste) would make resolve() treat the input as a CWD-relative path
  // segment, causing false 403s on /save and false 404s on /delete. /check
  // also trims each segment upstream; doing it here is idempotent and keeps
  // all endpoints consistent.
  return resolve(path.trim());
}

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

  const normalizedPath = normalizePath(path);

  if (!(await isPathAllowed(normalizedPath, ALLOWED_ROOTS))) {
    return c.json({ error: "Access denied" }, 403);
  }

  // Upsert: insert or update title on conflict, returning the id in one query.
  // `created_at` is always bumped to "now" on conflict so that re-saving an
  // existing item moves it to the top of the list (which is ordered by
  // created_at DESC).
  const stmt = db.prepare(`
    INSERT INTO reading_list (user_id, path, title)
    VALUES (?, ?, COALESCE(?, ?))
    ON CONFLICT(user_id, path) DO UPDATE SET
      title = CASE
        WHEN ? IS NULL THEN reading_list.title
        ELSE excluded.title
      END,
      created_at = (unixepoch() * 1000)
    RETURNING id
  `);

  const titleOrNull = title ?? null;
  const row = stmt.get(
    userId,
    normalizedPath,
    titleOrNull,
    basename(normalizedPath),
    titleOrNull,
  ) as { id: number };

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
  `).all(userId) as Array<{ id: number; path: string; title: string | null; created_at: number }>;

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

  // Trim each segment first so `?paths=a, b` doesn't produce a path relative
  // to CWD after normalization. The response is keyed by the *trimmed* input
  // (universal cleanup, not a path-semantic normalization), so clients can
  // look up results using essentially the paths they sent — just without the
  // accidental whitespace.
  const originalInputs = [
    ...new Set(
      pathsParam.split(",").map((p) => p.trim()).filter(Boolean),
    ),
  ];
  if (originalInputs.length === 0) {
    return c.json({ saved: {} });
  }

  // Cap at 256 paths per request
  if (originalInputs.length > 256) {
    return c.json({ error: "Too many paths (max 256)" }, 413);
  }

  const normalizedByOriginal = new Map<string, string>();
  for (const original of originalInputs) {
    normalizedByOriginal.set(original, normalizePath(original));
  }
  const uniqueNormalized = [...new Set(normalizedByOriginal.values())];

  // Query all matching paths for this user in one go
  const placeholders = uniqueNormalized.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT path FROM reading_list
    WHERE user_id = ? AND path IN (${placeholders})
  `).all(userId, ...uniqueNormalized) as Array<{ path: string }>;

  const savedSet = new Set(rows.map((r) => r.path));
  const saved: Record<string, boolean> = {};
  for (const original of originalInputs) {
    const normalized = normalizedByOriginal.get(original)!;
    saved[original] = savedSet.has(normalized);
  }

  return c.json({ saved });
});

// POST /delete — hard delete a reading list item
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
    const normalizedPath = normalizePath(path);
    const result = db.prepare(
      "DELETE FROM reading_list WHERE path = ? AND user_id = ?"
    ).run(normalizedPath, userId);

    if (result.changes === 0) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json({ ok: true });
  }

  return c.json({ error: "id or path is required" }, 400);
});

export { app as readingListRoute };
