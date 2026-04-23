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

export function tracedQuery<T>(op: string, table: string, fn: () => T): T {
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

// Proxy wrapping ALL .prepare() usage.
//
// Three classes of method need distinct handling:
//
//  1. TRACED_SYNC_METHODS (`get`, `all`, `run`) — synchronous execute-and-return.
//     Wrap the whole call in tracedQuery so the span captures elapsed time +
//     any thrown error.
//
//  2. `iterate` — returns a lazy iterator SYNCHRONOUSLY; the actual row fetches
//     happen later as the caller consumes the iterator. Wrapping it like a sync
//     method ends the span before any row is pulled, recording ~0µs and missing
//     any error raised during iteration. Instead we hand back an iterator that
//     starts the span eagerly and ends it on exhaustion, early return, or throw.
//
//  3. CONFIGURATOR_METHODS (`pluck`, `expand`, `raw`, `safeIntegers`, `bind`) —
//     mutate the statement and return `this` for chaining. Returning the raw
//     `s` here would hand the caller an UNPROXIED statement, so the subsequent
//     `.get()/.all()/.iterate()` would bypass all tracing. We re-route these
//     to run the configurator on `s` and return the outer Proxy so tracing
//     stays intact across the chain.
//
//     NOTE: `columns()` is deliberately EXCLUDED. Despite being a configurator-
//     adjacent introspection API, it returns `ColumnDefinition[]`, not `this`
//     — wrapping it here would replace that array with the statement proxy and
//     break callers. It falls through to the default branch which returns the
//     method bound to the real statement.
const TRACED_SYNC_METHODS = new Set(['get', 'all', 'run']);
const CONFIGURATOR_METHODS = new Set([
  'pluck',
  'expand',
  'raw',
  'safeIntegers',
  'bind',
]);

export const db: DatabaseType = new Proxy(rawDb, {
  get(target, prop) {
    if (prop === 'prepare') {
      return (sql: string) => {
        const stmt = target.prepare(sql);
        const table = extractTable(sql);
        const op = extractOperation(sql);
        const stmtProxy: typeof stmt = new Proxy(stmt, {
          get(s, method) {
            const methodStr = method as string;

            if (TRACED_SYNC_METHODS.has(methodStr)) {
              return (...args: unknown[]) =>
                tracedQuery(op, table, () =>
                  Reflect.apply(s[method as keyof typeof s] as Function, s, args)
                );
            }

            if (methodStr === 'iterate') {
              return (...args: unknown[]) => {
                // Start the span BEFORE invoking iterate so we capture
                // any throw from the prepare/bind phase, and keep it
                // open across the full consumer loop. We end it on
                // StopIteration, caller-initiated .return(), or .throw().
                const span = dbTracer.startSpan(`db.${op.toLowerCase()}`, {
                  attributes: {
                    'db.system': 'sqlite',
                    'db.operation': op,
                    'db.sql.table': table,
                  },
                });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let innerIter: IterableIterator<unknown> & { return?: (value?: any) => IteratorResult<unknown> };
                try {
                  innerIter = Reflect.apply(
                    s.iterate as Function,
                    s,
                    args
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ) as any;
                } catch (err) {
                  span.recordException(err instanceof Error ? err : String(err));
                  span.setStatus({ code: SpanStatusCode.ERROR });
                  span.end();
                  throw err;
                }
                // Hand back a wrapper iterator that delegates to the inner
                // better-sqlite3 iterator but ends the span exactly once,
                // on whichever exit path fires first. Using an explicit
                // iterator object (not a generator) avoids double-calling
                // `.return()` on the underlying cursor, which previously
                // left the DB connection in a "busy" state.
                let ended = false;
                const endOnce = () => {
                  if (ended) return;
                  ended = true;
                  span.end();
                };
                const wrapper: IterableIterator<unknown> = {
                  [Symbol.iterator]() { return this; },
                  next() {
                    try {
                      const result = innerIter.next();
                      if (result.done) endOnce();
                      return result;
                    } catch (err) {
                      span.recordException(err instanceof Error ? err : String(err));
                      span.setStatus({ code: SpanStatusCode.ERROR });
                      endOnce();
                      throw err;
                    }
                  },
                  return(value?: unknown): IteratorResult<unknown> {
                    try {
                      const r = innerIter.return?.(value) ?? { value: undefined, done: true };
                      endOnce();
                      return r;
                    } catch (err) {
                      span.recordException(err instanceof Error ? err : String(err));
                      span.setStatus({ code: SpanStatusCode.ERROR });
                      endOnce();
                      throw err;
                    }
                  },
                };
                return wrapper;
              };
            }

            if (CONFIGURATOR_METHODS.has(methodStr)) {
              const orig = s[method as keyof typeof s] as Function | undefined;
              if (typeof orig !== 'function') return orig;
              return (...args: unknown[]) => {
                // Run the configurator on the underlying statement, then
                // return the outer proxy so subsequent chained calls
                // (.get / .all / .iterate) remain traced.
                Reflect.apply(orig, s, args);
                return stmtProxy;
              };
            }

            const val = s[method as keyof typeof s];
            if (typeof val === 'function') return (val as Function).bind(s);
            return val;
          },
        });
        return stmtProxy;
      };
    }
    const val = target[prop as keyof typeof target];
    if (typeof val === 'function') return (val as Function).bind(target);
    return val;
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
