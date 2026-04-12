import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";

/**
 * Regression test for the reading_list TEXT → INTEGER migration.
 *
 * Early builds of reading_list shipped with `created_at TEXT DEFAULT
 * (datetime('now'))`. The current route layer assumes epoch-ms INTEGER.
 * `CREATE TABLE IF NOT EXISTS` never rewrites an existing schema, so the
 * bootstrap in db.ts must detect the legacy column type and rebuild the
 * table in place.
 *
 * This test replays that bootstrap logic against an in-memory DB pre-seeded
 * with the legacy schema + a couple rows, and asserts that the rebuild
 * preserves data while converting timestamps.
 */

function runMigration(db: Database.Database) {
  db.exec(`
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
  `);

  const cols = db
    .prepare("PRAGMA table_info(reading_list)")
    .all() as Array<{ name: string; type: string }>;
  const createdAtCol = cols.find((c) => c.name === "created_at");
  if (createdAtCol && createdAtCol.type.toUpperCase() !== "INTEGER") {
    // Retry-safe: mirrors db.ts — clean up any leftover reading_list_new from
    // a previous failed attempt, then wrap the rebuild in a try/catch that
    // rolls back + drops the scratch table if anything throws.
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

describe("reading_list TEXT → INTEGER migration", () => {
  it("rebuilds the table and converts ISO timestamps to epoch-ms", () => {
    const db = new Database(":memory:");
    // Seed with the legacy schema (from #134).
    db.exec(`
      CREATE TABLE reading_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        path TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, path)
      );

      CREATE INDEX idx_reading_list_user
        ON reading_list(user_id, created_at DESC);

      CREATE INDEX idx_reading_list_user_path
        ON reading_list(user_id, path);

      INSERT INTO reading_list (user_id, path, title, created_at)
      VALUES
        ('u1', '/home/claude/code/a.ts', 'A', '2025-01-01 00:00:00'),
        ('u1', '/home/claude/code/b.ts', 'B', '2025-06-15 12:30:00');
    `);

    runMigration(db);

    // Schema should now have INTEGER created_at.
    const cols = db
      .prepare("PRAGMA table_info(reading_list)")
      .all() as Array<{ name: string; type: string }>;
    const createdAtCol = cols.find((c) => c.name === "created_at")!;
    expect(createdAtCol.type.toUpperCase()).toBe("INTEGER");

    // Row data preserved.
    const rows = db
      .prepare("SELECT user_id, path, title, created_at FROM reading_list ORDER BY path")
      .all() as Array<{ user_id: string; path: string; title: string; created_at: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      user_id: "u1",
      path: "/home/claude/code/a.ts",
      title: "A",
    });
    expect(typeof rows[0].created_at).toBe("number");
    // 2025-01-01 00:00:00 UTC in epoch-ms
    expect(rows[0].created_at).toBe(Date.UTC(2025, 0, 1, 0, 0, 0));
    expect(rows[1].created_at).toBe(Date.UTC(2025, 5, 15, 12, 30, 0));

    // UNIQUE(user_id, path) still enforced.
    expect(() =>
      db
        .prepare("INSERT INTO reading_list (user_id, path, title) VALUES (?, ?, ?)")
        .run("u1", "/home/claude/code/a.ts", "dup"),
    ).toThrow();

    // Redundant (user_id, path) index should have been dropped (the one
    // duplicated by UNIQUE). The user-ordering index should remain.
    const indexes = db
      .prepare("PRAGMA index_list(reading_list)")
      .all() as Array<{ name: string }>;
    const namedIndexes = indexes.map((i) => i.name);
    expect(namedIndexes).toContain("idx_reading_list_user");
    expect(namedIndexes).not.toContain("idx_reading_list_user_path");
  });

  it("cleans up a leftover reading_list_new from a previously aborted migration", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE reading_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        path TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, path)
      );
      INSERT INTO reading_list (user_id, path, title, created_at)
      VALUES ('u1', '/home/claude/code/a.ts', 'A', '2025-01-01 00:00:00');

      -- Simulate a half-finished previous migration attempt: the scratch
      -- table exists with stale data but the real table was never swapped.
      CREATE TABLE reading_list_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        path TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(user_id, path)
      );
      INSERT INTO reading_list_new (user_id, path, title, created_at)
      VALUES ('stale-user', '/stale/path', 'Stale', 999);
    `);

    // Should not throw — the retry-safe migration must drop the stale
    // reading_list_new before recreating it fresh.
    expect(() => runMigration(db)).not.toThrow();

    // Real data is preserved.
    const rows = db
      .prepare("SELECT user_id, path, title FROM reading_list")
      .all() as Array<{ user_id: string; path: string; title: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: "u1",
      path: "/home/claude/code/a.ts",
      title: "A",
    });

    // The stale scratch-table data did NOT leak through.
    expect(rows.find((r) => r.user_id === "stale-user")).toBeUndefined();

    // And the scratch table itself is gone after a successful rebuild.
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).not.toContain("reading_list_new");
  });

  it("is a no-op when created_at is already INTEGER", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE reading_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        path TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE(user_id, path)
      );
      INSERT INTO reading_list (user_id, path, title, created_at)
      VALUES ('u1', '/home/claude/code/a.ts', 'A', 1700000000000);
    `);

    runMigration(db);

    const row = db
      .prepare("SELECT created_at FROM reading_list WHERE path = ?")
      .get("/home/claude/code/a.ts") as { created_at: number };
    expect(row.created_at).toBe(1700000000000);
  });
});
