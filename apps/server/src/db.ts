import Database, { type Database as DatabaseType } from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const DATA_DIR = join(process.env.HOME || "/home/claude", "data");
mkdirSync(DATA_DIR, { recursive: true });

const db: DatabaseType = new Database(join(DATA_DIR, "cpc-voice.db"));

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

  CREATE INDEX IF NOT EXISTS idx_reading_list_user_path
    ON reading_list(user_id, path);
`);

export { db };
export type { DatabaseType };
