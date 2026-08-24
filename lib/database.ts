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
  migrate(db);
  globalThis.__radarDatabase = db;
  return db;
}

function migrate(db: DatabaseSync): void {
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
  `);
}
