import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { radarDataDirectory } from "./data-directory.js";

/**
 * 只有 Radar 服务进程碰这个句柄——它是 SQLite 的唯一写者（ADR 0012），
 * CLI 一律走 HTTP。
 */
let openDatabase: DatabaseSync | undefined;

export function database(): DatabaseSync {
  if (openDatabase?.isOpen) return openDatabase;

  const dataDirectory = radarDataDirectory();
  mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(resolve(dataDirectory, "radar.sqlite"), { timeout: 5_000 });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  initializeSchema(db);
  openDatabase = db;
  return db;
}

export function closeDatabase(): void {
  if (openDatabase?.isOpen) openDatabase.close();
  openDatabase = undefined;
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS radar_briefs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS radar_brief_revisions (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL REFERENCES radar_briefs(id),
      revision_number INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (brief_id, revision_number)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS instance_sources (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      health_status TEXT NOT NULL CHECK (health_status IN ('healthy', 'unhealthy')),
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS brief_source_configurations (
      brief_id TEXT NOT NULL REFERENCES radar_briefs(id),
      source_id TEXT NOT NULL REFERENCES instance_sources(id),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      added_at TEXT NOT NULL,
      removed_at TEXT,
      PRIMARY KEY (brief_id, source_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_contents (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES instance_sources(id),
      external_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      origin_url TEXT NOT NULL,
      public_locator_url TEXT,
      public_locator_status TEXT NOT NULL CHECK (public_locator_status IN ('available', 'withheld_unverified')),
      public_site_url TEXT,
      published_at TEXT,
      raw_json TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      UNIQUE (source_id, content_hash)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS brief_pending_contents (
      brief_id TEXT NOT NULL REFERENCES radar_briefs(id),
      source_content_id TEXT NOT NULL REFERENCES source_contents(id),
      queued_at TEXT NOT NULL,
      PRIMARY KEY (brief_id, source_content_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_acquisition_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES instance_sources(id),
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      new_content_count INTEGER NOT NULL DEFAULT 0,
      reused_content_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS judgments (
      id TEXT PRIMARY KEY,
      brief_id TEXT NOT NULL REFERENCES radar_briefs(id),
      brief_revision_id TEXT NOT NULL REFERENCES radar_brief_revisions(id),
      source_content_id TEXT NOT NULL REFERENCES source_contents(id),
      relevant INTEGER NOT NULL CHECK (relevant IN (0, 1)),
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS judgment_signals (
      judgment_id TEXT NOT NULL REFERENCES judgments(id),
      source_content_id TEXT NOT NULL REFERENCES source_contents(id),
      PRIMARY KEY (judgment_id, source_content_id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS source_contents_by_source ON source_contents(source_id, acquired_at DESC);
    CREATE INDEX IF NOT EXISTS pending_contents_by_brief ON brief_pending_contents(brief_id, queued_at DESC);
    CREATE INDEX IF NOT EXISTS source_runs_by_source ON source_acquisition_runs(source_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS judgments_by_brief ON judgments(brief_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS judgments_by_content ON judgments(brief_id, source_content_id);
  `);
}
