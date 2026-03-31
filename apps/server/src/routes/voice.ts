import { Hono } from "hono";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import type { TelegramUser } from "../auth.js";

// Load OpenAI key from secrets file if not already in env
function loadOpenAIEnv() {
  const secretsPath = join(process.env.HOME || "/home/claude", ".secrets/openai.env");
  try {
    const content = readFileSync(secretsPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // File may not exist yet — transcribe will fail with a clear error
  }
}

loadOpenAIEnv();

const app = new Hono();

function getUserId(c: any): string {
  const user = c.get("telegramUser") as TelegramUser | undefined;
  return user ? String(user.id) : "default";
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

// POST /transcribe — accept audio file, shell out to ~/bin/transcribe
app.post("/transcribe", async (c) => {
  const body = await c.req.parseBody();
  const audioFile = body["audio"];

  if (!audioFile || typeof audioFile === "string") {
    return c.json({ error: "No audio file provided" }, 400);
  }

  const ext = (audioFile as File).name?.split(".").pop() || "webm";
  const tmpPath = join(tmpdir(), `cpc-audio-${nanoid(8)}.${ext}`);

  try {
    const arrayBuffer = await (audioFile as File).arrayBuffer();
    writeFileSync(tmpPath, Buffer.from(arrayBuffer));

    const transcribeBin = join(process.env.HOME || "/home/claude", "bin/transcribe");
    const result = execSync(`${transcribeBin} ${tmpPath}`, {
      shell: "/bin/bash",
      encoding: "utf-8",
      env: { ...process.env },
    });
    const text = result.trim();

    return c.json({ text });
  } catch (err: any) {
    return c.json({ error: err.message || "Transcription failed" }, 500);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* already gone */ }
  }
});

// POST /transcripts — create a new transcript
app.post("/transcripts", async (c) => {
  const userId = getUserId(c);
  const { title = "Untitled", body: bodyText = "" } = await c.req.json<{
    title?: string;
    body?: string;
  }>();

  const id = nanoid();
  const now = Date.now();
  const wordCount = countWords(bodyText);

  db.prepare(`
    INSERT INTO transcripts (id, user_id, title, body, word_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, title, bodyText, wordCount, now, now);

  const row = db.prepare("SELECT * FROM transcripts WHERE id = ?").get(id);
  return c.json(row, 201);
});

// GET /transcripts — list non-deleted transcripts for user
app.get("/transcripts", (c) => {
  const userId = getUserId(c);
  const sort = c.req.query("sort") || "date";
  const tag = c.req.query("tag");

  const orderBy = sort === "alpha" ? "title ASC" : "created_at DESC";

  let rows: any[];
  if (tag) {
    rows = db.prepare(`
      SELECT t.id, t.user_id, t.title, t.description, t.word_count,
             t.created_at, t.updated_at,
             SUBSTR(t.body, 1, 200) AS preview
      FROM transcripts t
      JOIN transcript_tags tt ON tt.transcript_id = t.id
      WHERE t.user_id = ? AND t.deleted_at IS NULL AND tt.tag = ?
      ORDER BY ${orderBy}
    `).all(userId, tag);
  } else {
    rows = db.prepare(`
      SELECT id, user_id, title, description, word_count,
             created_at, updated_at,
             SUBSTR(body, 1, 200) AS preview
      FROM transcripts
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY ${orderBy}
    `).all(userId);
  }

  return c.json(rows);
});

// GET /transcripts/:id — single transcript with full body and tags
app.get("/transcripts/:id", (c) => {
  const userId = getUserId(c);
  const { id } = c.req.param();

  const row = db.prepare(`
    SELECT * FROM transcripts WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).get(id, userId);

  if (!row) return c.json({ error: "Not found" }, 404);

  const tags = (db.prepare(
    "SELECT tag FROM transcript_tags WHERE transcript_id = ?"
  ).all(id) as { tag: string }[]).map((r) => r.tag);

  return c.json({ ...(row as object), tags });
});

// PATCH /transcripts/:id — update title/description/body or append to body
app.patch("/transcripts/:id", async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.param();

  const existing = db.prepare(`
    SELECT * FROM transcripts WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).get(id, userId) as any;

  if (!existing) return c.json({ error: "Not found" }, 404);

  const updates = await c.req.json<{
    title?: string;
    description?: string;
    body?: string;
    append?: string;
  }>();

  const title = updates.title ?? existing.title;
  const description = updates.description ?? existing.description;

  let body: string;
  if (typeof updates.append === "string") {
    body = existing.body + (existing.body ? "\n" : "") + updates.append;
  } else {
    body = updates.body ?? existing.body;
  }

  const wordCount = countWords(body);
  const now = Date.now();

  db.prepare(`
    UPDATE transcripts
    SET title = ?, description = ?, body = ?, word_count = ?, updated_at = ?
    WHERE id = ?
  `).run(title, description, body, wordCount, now, id);

  const row = db.prepare("SELECT * FROM transcripts WHERE id = ?").get(id);
  return c.json(row);
});

// DELETE /transcripts/:id — soft delete
app.delete("/transcripts/:id", (c) => {
  const userId = getUserId(c);
  const { id } = c.req.param();

  const existing = db.prepare(`
    SELECT id FROM transcripts WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).get(id, userId);

  if (!existing) return c.json({ error: "Not found" }, 404);

  db.prepare("UPDATE transcripts SET deleted_at = ? WHERE id = ?").run(Date.now(), id);
  return c.json({ ok: true });
});

export { app as voiceRoute };
