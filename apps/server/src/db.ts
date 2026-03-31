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
`);

export { db };
export type { DatabaseType };
