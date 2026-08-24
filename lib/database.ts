import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { radarDataDirectory } from "@/lib/data-directory";

declare global {
  var __radarDatabase: DatabaseSync | undefined;
}

export function database(): DatabaseSync {
  if (globalThis.__radarDatabase?.isOpen) return globalThis.__radarDatabase;

  const dataDirectory = radarDataDirectory();
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
      public_locator_url TEXT,
      public_locator_status TEXT NOT NULL CHECK (public_locator_status IN ('available', 'withheld_unverified')),
      public_site_url TEXT,
      published_at TEXT,
      raw_json TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      UNIQUE (content_id, version_number),
      UNIQUE (content_id, content_hash)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS project_source_versions (
      project_id TEXT NOT NULL REFERENCES radar_projects(id),
      source_version_id TEXT NOT NULL REFERENCES source_versions(id),
      visible_at TEXT NOT NULL,
      PRIMARY KEY (project_id, source_version_id)
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

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES radar_projects(id),
      brief_revision_id TEXT NOT NULL REFERENCES radar_brief_revisions(id),
      source_version_id TEXT NOT NULL REFERENCES source_versions(id),
      adapter_kind TEXT NOT NULL,
      process_instance_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
      outcome TEXT CHECK (outcome IN ('matched', 'no_match')),
      reason TEXT,
      error TEXT,
      signal_id TEXT REFERENCES signals(id),
      intelligence_item_id TEXT REFERENCES intelligence_items(id),
      intelligence_item_revision_id TEXT REFERENCES intelligence_item_revisions(id),
      started_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES radar_projects(id),
      brief_revision_id TEXT NOT NULL REFERENCES radar_brief_revisions(id),
      source_version_id TEXT NOT NULL REFERENCES source_versions(id),
      evidence_quote TEXT NOT NULL,
      evidence_field TEXT NOT NULL CHECK (evidence_field IN ('title', 'body')),
      evidence_start INTEGER NOT NULL CHECK (evidence_start >= 0),
      evidence_end INTEGER NOT NULL CHECK (evidence_end > evidence_start),
      created_at TEXT NOT NULL,
      UNIQUE (project_id, brief_revision_id, source_version_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS intelligence_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES radar_projects(id),
      judgment_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (project_id, judgment_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS intelligence_item_revisions (
      id TEXT PRIMARY KEY,
      intelligence_item_id TEXT NOT NULL REFERENCES intelligence_items(id),
      revision_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      judgment TEXT NOT NULL,
      rationale TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (intelligence_item_id, revision_number)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS intelligence_revision_signals (
      intelligence_item_revision_id TEXT NOT NULL REFERENCES intelligence_item_revisions(id),
      signal_id TEXT NOT NULL REFERENCES signals(id),
      PRIMARY KEY (intelligence_item_revision_id, signal_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS report_generation_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES radar_projects(id),
      retried_from_run_id TEXT REFERENCES report_generation_runs(id),
      adapter_kind TEXT NOT NULL,
      process_instance_id TEXT NOT NULL,
      trigger_method TEXT NOT NULL CHECK (trigger_method IN ('manual')),
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
      source_cutoff_at TEXT NOT NULL,
      input_snapshot_json TEXT NOT NULL,
      error TEXT,
      report_id TEXT REFERENCES reports(id),
      started_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES radar_projects(id),
      generation_run_id TEXT NOT NULL UNIQUE REFERENCES report_generation_runs(id),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS report_revisions (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES reports(id),
      revision_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      purpose TEXT NOT NULL,
      audience TEXT NOT NULL,
      angle TEXT NOT NULL,
      source_cutoff_at TEXT NOT NULL,
      trigger_method TEXT NOT NULL CHECK (trigger_method IN ('manual')),
      generation_context_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (report_id, revision_number)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS report_revision_intelligence (
      report_revision_id TEXT NOT NULL REFERENCES report_revisions(id),
      intelligence_item_revision_id TEXT NOT NULL REFERENCES intelligence_item_revisions(id),
      PRIMARY KEY (report_revision_id, intelligence_item_revision_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS report_claims (
      id TEXT PRIMARY KEY,
      report_revision_id TEXT NOT NULL REFERENCES report_revisions(id),
      position INTEGER NOT NULL CHECK (position >= 0),
      text TEXT NOT NULL,
      epistemic_role TEXT NOT NULL CHECK (epistemic_role IN ('evidence', 'inference', 'user_viewpoint')),
      intelligence_item_revision_id TEXT NOT NULL REFERENCES intelligence_item_revisions(id),
      UNIQUE (report_revision_id, position)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS report_claim_signals (
      report_claim_id TEXT NOT NULL REFERENCES report_claims(id),
      signal_id TEXT NOT NULL REFERENCES signals(id),
      PRIMARY KEY (report_claim_id, signal_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS material_packages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES radar_projects(id),
      report_revision_id TEXT NOT NULL REFERENCES report_revisions(id),
      target TEXT NOT NULL CHECK (target IN ('html')),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS material_package_runs (
      id TEXT PRIMARY KEY,
      material_package_id TEXT NOT NULL REFERENCES material_packages(id),
      retried_from_run_id TEXT REFERENCES material_package_runs(id),
      process_instance_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
      input_snapshot_json TEXT NOT NULL,
      artifact_directory TEXT,
      cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_pending IN (0, 1)),
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS source_contents_by_source ON source_contents(source_id);
    CREATE INDEX IF NOT EXISTS source_versions_by_content ON source_versions(content_id, version_number DESC);
    CREATE INDEX IF NOT EXISTS project_source_versions_by_project ON project_source_versions(project_id, visible_at DESC);
    CREATE INDEX IF NOT EXISTS source_runs_by_source ON source_acquisition_runs(source_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS agent_runs_by_project ON agent_runs(project_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS agent_runs_by_input ON agent_runs(project_id, brief_revision_id, source_version_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS signals_by_project ON signals(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS intelligence_items_by_project ON intelligence_items(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS report_runs_by_project ON report_generation_runs(project_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS reports_by_project ON reports(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS report_claims_by_revision ON report_claims(report_revision_id, position);
    CREATE INDEX IF NOT EXISTS material_packages_by_project ON material_packages(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS material_package_runs_by_package ON material_package_runs(material_package_id, started_at DESC);
  `);
}
