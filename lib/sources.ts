import { createHash, randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import { fetchFeed, type FeedEntry } from "@/lib/feed";

export type SourceVersion = {
  id: string;
  number: number;
  title: string;
  originUrl: string;
  publishedAt: string | null;
  acquiredAt: string;
};

export type ProjectSource = {
  id: string;
  name: string;
  url: string;
  active: boolean;
  healthStatus: "healthy" | "unhealthy";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  latestRunMessage: string;
  versions: SourceVersion[];
};

type SourceRow = {
  id: string;
  name: string;
  url: string;
  active: number;
  health_status: "healthy" | "unhealthy";
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  run_status: "success" | "failed" | null;
  new_version_count: number | null;
  reused_version_count: number | null;
};

type VersionRow = {
  id: string;
  version_number: number;
  title: string;
  origin_url: string;
  published_at: string | null;
  acquired_at: string;
};

export async function validateAndLinkSource(projectId: string, rawUrl: string): Promise<ProjectSource> {
  const url = httpUrl(rawUrl);
  const feed = await fetchFeed(url);
  const db = database();
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM instance_sources WHERE url = ?").get(url) as
    | { id: string }
    | undefined;
  const sourceId = existing?.id ?? randomUUID();

  db.exec("BEGIN IMMEDIATE");
  try {
    if (existing) {
      db.prepare(
        `UPDATE instance_sources
         SET name = ?, health_status = 'healthy', last_attempt_at = ?, last_error = NULL
         WHERE id = ?`,
      ).run(feed.name, now, sourceId);
    } else {
      db.prepare(
        `INSERT INTO instance_sources
          (id, url, name, health_status, last_attempt_at, created_at)
         VALUES (?, ?, ?, 'healthy', ?, ?)`,
      ).run(sourceId, url, feed.name, now, now);
    }
    db.prepare(
      `INSERT INTO project_source_configurations
        (project_id, source_id, active, added_at, removed_at)
       VALUES (?, ?, 1, ?, NULL)
       ON CONFLICT(project_id, source_id) DO UPDATE SET active = 1, removed_at = NULL`,
    ).run(projectId, sourceId, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getProjectSource(projectId, sourceId);
}

export async function collectSource(projectId: string, sourceId: string): Promise<{ message: string }> {
  const db = database();
  const source = db.prepare(
    `SELECT source.url FROM instance_sources AS source
     JOIN project_source_configurations AS config ON config.source_id = source.id
     WHERE source.id = ? AND config.project_id = ? AND config.active = 1`,
  ).get(sourceId, projectId) as { url: string } | undefined;
  if (!source) throw new Error("这个来源已停止使用；重新验证 URL 后才能采集。");

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO source_acquisition_runs (id, source_id, status, started_at)
     VALUES (?, ?, 'running', ?)`,
  ).run(runId, sourceId, startedAt);

  try {
    const feed = await fetchFeed(source.url);
    const completedAt = new Date().toISOString();
    let created = 0;
    let reused = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of feed.entries) {
        if (persistEntryVersion(sourceId, entry, completedAt) === "created") created += 1;
        else reused += 1;
      }
      db.prepare(
        `UPDATE instance_sources
         SET name = ?, health_status = 'healthy', last_attempt_at = ?, last_success_at = ?, last_error = NULL
         WHERE id = ?`,
      ).run(feed.name, completedAt, completedAt, sourceId);
      db.prepare(
        `UPDATE source_acquisition_runs
         SET status = 'success', completed_at = ?, new_version_count = ?, reused_version_count = ?
         WHERE id = ?`,
      ).run(completedAt, created, reused, runId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { message: acquisitionMessage(created, reused) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedAt = new Date().toISOString();
    db.prepare(
      `UPDATE instance_sources
       SET health_status = 'unhealthy', last_attempt_at = ?, last_error = ? WHERE id = ?`,
    ).run(failedAt, message, sourceId);
    db.prepare(
      `UPDATE source_acquisition_runs
       SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`,
    ).run(failedAt, message, runId);
    throw new Error(message);
  }
}

export function stopUsingSource(projectId: string, sourceId: string): void {
  const result = database().prepare(
    `UPDATE project_source_configurations
     SET active = 0, removed_at = ? WHERE project_id = ? AND source_id = ?`,
  ).run(new Date().toISOString(), projectId, sourceId);
  if (result.changes === 0) throw new Error("找不到这个 Project 的来源配置。");
}

export function listProjectSources(projectId: string): ProjectSource[] {
  const rows = database().prepare(
    `${sourceSelection} WHERE config.project_id = ?
     ORDER BY config.active DESC, config.added_at DESC`,
  ).all(projectId) as SourceRow[];
  return rows.map((row) => mapProjectSource(row, listSourceVersions(row.id)));
}

function getProjectSource(projectId: string, sourceId: string): ProjectSource {
  const row = database().prepare(
    `${sourceSelection} WHERE config.project_id = ? AND source.id = ?`,
  ).get(projectId, sourceId) as SourceRow | undefined;
  if (!row) throw new Error("来源保存后无法重新读取。");
  return mapProjectSource(row, listSourceVersions(row.id));
}

const sourceSelection = `
  SELECT source.id, source.name, source.url, config.active,
    source.health_status, source.last_attempt_at, source.last_success_at, source.last_error,
    latest_run.status AS run_status, latest_run.new_version_count, latest_run.reused_version_count
  FROM project_source_configurations AS config
  JOIN instance_sources AS source ON source.id = config.source_id
  LEFT JOIN source_acquisition_runs AS latest_run ON latest_run.id = (
    SELECT run.id FROM source_acquisition_runs AS run
    WHERE run.source_id = source.id ORDER BY run.started_at DESC LIMIT 1
  )
`;

function persistEntryVersion(sourceId: string, entry: FeedEntry, acquiredAt: string): "created" | "reused" {
  const db = database();
  const contentId = digest(`${sourceId}\u0000${entry.externalId}`);
  db.prepare(
    `INSERT INTO source_contents (id, source_id, external_id, origin_url, created_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id, external_id) DO NOTHING`,
  ).run(contentId, sourceId, entry.externalId, entry.originUrl, acquiredAt);

  const contentHash = digest(JSON.stringify({
    title: entry.title,
    body: entry.body,
    originUrl: entry.originUrl,
    publishedAt: entry.publishedAt,
  }));
  const existing = db.prepare(
    "SELECT id FROM source_versions WHERE content_id = ? AND content_hash = ?",
  ).get(contentId, contentHash);
  if (existing) return "reused";

  const next = db.prepare(
    "SELECT COALESCE(MAX(version_number), 0) + 1 AS number FROM source_versions WHERE content_id = ?",
  ).get(contentId) as { number: number };
  db.prepare(
    `INSERT INTO source_versions
      (id, content_id, version_number, content_hash, title, body, origin_url, published_at, raw_json, acquired_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    digest(`${contentId}\u0000${contentHash}`),
    contentId,
    next.number,
    contentHash,
    entry.title,
    entry.body,
    entry.originUrl,
    entry.publishedAt,
    entry.rawPayload,
    acquiredAt,
  );
  return "created";
}

function listSourceVersions(sourceId: string): SourceVersion[] {
  const rows = database().prepare(
    `SELECT version.id, version.version_number, version.title, version.origin_url,
      version.published_at, version.acquired_at
     FROM source_versions AS version
     JOIN source_contents AS content ON content.id = version.content_id
     WHERE content.source_id = ?
     ORDER BY version.acquired_at DESC, version.version_number DESC`,
  ).all(sourceId) as VersionRow[];
  return rows.map((row) => ({
    id: row.id,
    number: row.version_number,
    title: row.title,
    originUrl: row.origin_url,
    publishedAt: row.published_at,
    acquiredAt: row.acquired_at,
  }));
}

function mapProjectSource(row: SourceRow, versions: SourceVersion[]): ProjectSource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    active: row.active === 1,
    healthStatus: row.health_status,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    latestRunMessage: latestRunMessage(row, versions.length),
    versions,
  };
}

function latestRunMessage(row: SourceRow, versionCount: number): string {
  if (!row.active) return "已停止后续采集，历史版本保留";
  if (row.run_status === "failed") return row.last_error ?? "采集失败，可以重试。";
  if (row.run_status === "success") {
    return acquisitionMessage(row.new_version_count ?? 0, row.reused_version_count ?? 0);
  }
  if (versionCount === 0) return "已验证，等待首次采集";
  return `${versionCount} 个不可变版本`;
}

function acquisitionMessage(created: number, reused: number): string {
  if (created > 0) return `本次新增 ${created} 个来源版本`;
  if (reused > 0) return `未发现内容变化，复用 ${reused} 个来源版本`;
  return "采集成功，Feed 当前没有来源内容";
}

function httpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请输入完整的 http:// 或 https:// Feed URL。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Feed URL 只支持 http:// 或 https://。");
  }
  url.hash = "";
  return url.toString();
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
