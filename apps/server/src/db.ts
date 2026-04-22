import Database, { type Database as DatabaseType } from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { SpanStatusCode } from "@opentelemetry/api";
import { getTracer } from "./lib/otel.js";

const DATA_DIR = join(process.env.HOME || "/home/claude", "data");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, "cpc-voice.db");
const rawDb: DatabaseType = new Database(DB_PATH);

// ── OTEL helpers ──────────────────────────────────────────────────────────────

function extractTable(sql: string): string {
  return sql.match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/i)?.[1] ?? 'unknown';
}

function extractOperation(sql: string): string {
  return sql.trim().split(/\s+/)[0]?.toUpperCase() ?? 'QUERY';
}

const dbTracer = getTracer('cpc-server-db');

function tracedQuery<T>(op: string, table: string, fn: () => T): T {
  const span = dbTracer.startSpan(`db.${op.toLowerCase()}`, {
    attributes: { 'db.system': 'sqlite', 'db.operation': op, 'db.sql.table': table },
  });
  try {
    return fn();
  } catch (err) {
    span.recordException(err instanceof Error ? err : String(err));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.end();
  }
}

// Proxy wrapping ALL .prepare() usage
const TRACED_STMT_METHODS = ['get', 'all', 'run', 'iterate', 'pluck', 'expand', 'raw'] as const;

export const db: DatabaseType = new Proxy(rawDb, {
  get(target, prop) {
    if (prop === 'prepare') {
      return (sql: string) => {
        const stmt = target.prepare(sql);
        const table = extractTable(sql);
        const op = extractOperation(sql);
        return new Proxy(stmt, {
          get(s, method) {
            if ((TRACED_STMT_METHODS as readonly string[]).includes(method as string)) {
              return (...args: unknown[]) =>
                tracedQuery(op, table, () => (s[method as keyof typeof s] as (...a: unknown[]) => unknown)(...args));
            }
            return s[method as keyof typeof s];
          },
        });
      };
    }
    return target[prop as keyof typeof target];
  },
});

// WAL mode for better concurrent reads
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled',
    description TEXT,
    body TEXT NOT NULL DEFAULT '',
    word_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS transcript_tags (
    transcript_id TEXT NOT NULL REFERENCES transcripts(id),
    tag TEXT NOT NULL,
    PRIMARY KEY (transcript_id, tag)
  );

  CREATE INDEX IF NOT EXISTS idx_transcripts_user ON transcripts(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tags_tag ON transcript_tags(tag);

  CREATE TABLE IF NOT EXISTS tldr_cache (
    content_hash TEXT NOT NULL,
    prompt_version INTEGER NOT NULL DEFAULT 1,
    model TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_path TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (content_hash, prompt_version, model)
  );
  CREATE INDEX IF NOT EXISTS idx_tldr_created ON tldr_cache(created_at DESC);

  CREATE TABLE IF NOT EXISTS reading_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    UNIQUE(user_id, path)
  );

  CREATE INDEX IF NOT EXISTS idx_reading_list_user
    ON reading_list(user_id, created_at DESC);
  -- Note: no explicit (user_id, path) index — the UNIQUE(user_id, path)
  -- constraint already creates an identical implicit index.
`);

// Prune stale TL;DR cache entries older than 30 days.
// Runs on every startup; idx_tldr_created keeps this fast.
db.exec(
  `DELETE FROM tldr_cache WHERE created_at < unixepoch() * 1000 - 30 * 86400 * 1000`
);

// Migration: early builds of reading_list shipped `created_at TEXT DEFAULT
// (datetime('now'))`. The route layer (and tests) now assume epoch-ms
// INTEGER. `CREATE TABLE IF NOT EXISTS` never rewrites an existing schema,
// so any deployment that ran #134 before this fix still has TEXT values.
// Detect it and rebuild the table in place (copy → drop → rename), converting
// ISO timestamps to epoch-ms.
{
  const cols = db
    .prepare("PRAGMA table_info(reading_list)")
    .all() as Array<{ name: string; type: string }>;
  const createdAtCol = cols.find((c) => c.name === "created_at");
  if (createdAtCol && createdAtCol.type.toUpperCase() !== "INTEGER") {
    // Retry-safe: drop any leftover `reading_list_new` from a previous failed
    // migration attempt before creating it fresh, and wrap the rebuild in a
    // try/catch with explicit ROLLBACK + cleanup so the next startup isn't
    // poisoned by a stale `reading_list_new` table.
    db.exec("DROP TABLE IF EXISTS reading_list_new");

    try {
      db.exec(`
        BEGIN;
        CREATE TABLE reading_list_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          path TEXT NOT NULL,
          title TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          UNIQUE(user_id, path)
        );
        INSERT INTO reading_list_new (id, user_id, path, title, created_at)
        SELECT
          id,
          user_id,
          path,
          title,
          CAST(strftime('%s', created_at) AS INTEGER) * 1000
        FROM reading_list;
        DROP INDEX IF EXISTS idx_reading_list_user;
        DROP INDEX IF EXISTS idx_reading_list_user_path;
        DROP TABLE reading_list;
        ALTER TABLE reading_list_new RENAME TO reading_list;
        CREATE INDEX IF NOT EXISTS idx_reading_list_user
          ON reading_list(user_id, created_at DESC);
        COMMIT;
      `);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Ignore rollback errors if no transaction is active.
      }
      db.exec("DROP TABLE IF EXISTS reading_list_new");
      throw error;
    }
  }
}

export { DB_PATH };
export type { DatabaseType };
