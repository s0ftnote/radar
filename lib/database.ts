import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

declare global {
  var __radarDatabase: DatabaseSync | undefined;
}

export function database(): DatabaseSync {
  if (globalThis.__radarDatabase?.isOpen) return globalThis.__radarDatabase;

  const dataDirectory = resolve(/* turbopackIgnore: true */ process.env.RADAR_DATA_DIR ?? ".radar");
  mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(resolve(dataDirectory, "radar.sqlite"), { timeout: 5_000 });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  initializeSchema(db);
  globalThis.__radarDatabase = db;
  return db;
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS radar_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS radar_brief_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES radar_projects(id),
      revision_number INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (project_id, revision_number)
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

    CREATE TABLE IF NOT EXISTS project_source_configurations (
      project_id TEXT NOT NULL REFERENCES radar_projects(id),
      source_id TEXT NOT NULL REFERENCES instance_sources(id),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      added_at TEXT NOT NULL,
      removed_at TEXT,
      PRIMARY KEY (project_id, source_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_contents (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES instance_sources(id),
      external_id TEXT NOT NULL,
      origin_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (source_id, external_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_versions (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL REFERENCES source_contents(id),
      version_number INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      origin_url TEXT NOT NULL,
      published_at TEXT,
      raw_json TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      UNIQUE (content_id, version_number),
      UNIQUE (content_id, content_hash)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_acquisition_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES instance_sources(id),
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      new_version_count INTEGER NOT NULL DEFAULT 0,
      reused_version_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS source_contents_by_source ON source_contents(source_id);
    CREATE INDEX IF NOT EXISTS source_versions_by_content ON source_versions(content_id, version_number DESC);
    CREATE INDEX IF NOT EXISTS source_runs_by_source ON source_acquisition_runs(source_id, started_at DESC);
  `);
}
