import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { database } from "./database.js";
import { fetchFeed, type FeedEntry } from "./feed.js";

export type SourceContent = {
  id: string;
  title: string;
  originUrl: string;
  publishedAt: string | null;
  acquiredAt: string;
};

export type BriefSource = {
  id: string;
  name: string;
  url: string;
  active: boolean;
  healthStatus: "healthy" | "unhealthy";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  usedByBriefCount: number;
  latestRun: {
    status: "not_collected" | "running" | "success" | "failed";
    newContentCount: number;
    reusedContentCount: number;
    error: string | null;
  };
  contents: SourceContent[];
};

export type AvailableInstanceSource = {
  id: string;
  name: string;
  url: string;
  healthStatus: "healthy" | "unhealthy";
  contentCount: number;
  usedByBriefCount: number;
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
  used_by_brief_count: number;
  run_status: "running" | "success" | "failed" | null;
  new_content_count: number | null;
  reused_content_count: number | null;
};

type ContentRow = {
  id: string;
  title: string;
  origin_url: string;
  published_at: string | null;
  acquired_at: string;
};

export async function validateAndLinkSource(briefId: string, rawUrl: string): Promise<BriefSource> {
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
    linkSourceToBrief(db, briefId, sourceId, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getBriefSource(briefId, sourceId);
}

export function linkSavedSource(briefId: string, sourceId: string): BriefSource {
  const db = database();
  const source = db.prepare("SELECT id FROM instance_sources WHERE id = ?").get(sourceId);
  if (!source) throw new Error("找不到这个已保存来源。");
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    linkSourceToBrief(db, briefId, sourceId, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getBriefSource(briefId, sourceId);
}

export async function collectSource(
  briefId: string,
  sourceId: string,
): Promise<{ newContentCount: number; reusedContentCount: number }> {
  const db = database();
  const source = db.prepare(
    `SELECT source.url FROM instance_sources AS source
     JOIN brief_source_configurations AS config ON config.source_id = source.id
     WHERE source.id = ? AND config.brief_id = ? AND config.active = 1`,
  ).get(sourceId, briefId) as { url: string } | undefined;
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
        if (persistEntry(sourceId, entry, completedAt) === "created") created += 1;
        else reused += 1;
      }
      db.prepare(
        `INSERT INTO brief_pending_contents (brief_id, source_content_id, queued_at)
         SELECT config.brief_id, content.id, ?
         FROM brief_source_configurations AS config
         JOIN source_contents AS content ON content.source_id = config.source_id
         WHERE config.source_id = ? AND config.active = 1
         ON CONFLICT(brief_id, source_content_id) DO NOTHING`,
      ).run(completedAt, sourceId);
      db.prepare(
        `UPDATE instance_sources
         SET name = ?, health_status = 'healthy', last_attempt_at = ?, last_success_at = ?, last_error = NULL
         WHERE id = ?`,
      ).run(feed.name, completedAt, completedAt, sourceId);
      db.prepare(
        `UPDATE source_acquisition_runs
         SET status = 'success', completed_at = ?, new_content_count = ?, reused_content_count = ?
         WHERE id = ?`,
      ).run(completedAt, created, reused, runId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { newContentCount: created, reusedContentCount: reused };
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

export function stopUsingSource(briefId: string, sourceId: string): void {
  const result = database().prepare(
    `UPDATE brief_source_configurations
     SET active = 0, removed_at = ? WHERE brief_id = ? AND source_id = ?`,
  ).run(new Date().toISOString(), briefId, sourceId);
  if (result.changes === 0) throw new Error("找不到这个 Radar Brief 的来源配置。");
}

export function listBriefSources(briefId: string): BriefSource[] {
  const rows = database().prepare(
    `${sourceSelection} WHERE config.brief_id = ?
     ORDER BY config.active DESC, config.added_at DESC`,
  ).all(briefId) as SourceRow[];
  return rows.map((row) => mapBriefSource(row, listSourceContents(briefId, row.id)));
}

export function listAvailableInstanceSources(briefId: string): AvailableInstanceSource[] {
  return database().prepare(
    `SELECT source.id, source.name, source.url, source.health_status,
      COUNT(DISTINCT content.id) AS content_count,
      COUNT(DISTINCT CASE WHEN config.active = 1 THEN config.brief_id END) AS used_by_brief_count
     FROM instance_sources AS source
     LEFT JOIN source_contents AS content ON content.source_id = source.id
     LEFT JOIN brief_source_configurations AS config ON config.source_id = source.id
     WHERE NOT EXISTS (
       SELECT 1 FROM brief_source_configurations AS current
       WHERE current.brief_id = ? AND current.source_id = source.id
     )
     GROUP BY source.id
     ORDER BY source.created_at DESC`,
  ).all(briefId).map((row) => {
    const source = row as {
      id: string;
      name: string;
      url: string;
      health_status: "healthy" | "unhealthy";
      content_count: number;
      used_by_brief_count: number;
    };
    return {
      id: source.id,
      name: source.name,
      url: source.url,
      healthStatus: source.health_status,
      contentCount: source.content_count,
      usedByBriefCount: source.used_by_brief_count,
    };
  });
}

function getBriefSource(briefId: string, sourceId: string): BriefSource {
  const row = database().prepare(
    `${sourceSelection} WHERE config.brief_id = ? AND source.id = ?`,
  ).get(briefId, sourceId) as SourceRow | undefined;
  if (!row) throw new Error("来源保存后无法重新读取。");
  return mapBriefSource(row, listSourceContents(briefId, row.id));
}

function linkSourceToBrief(
  db: DatabaseSync,
  briefId: string,
  sourceId: string,
  queuedAt: string,
): void {
  db.prepare(
    `INSERT INTO brief_source_configurations
      (brief_id, source_id, active, added_at, removed_at)
     VALUES (?, ?, 1, ?, NULL)
     ON CONFLICT(brief_id, source_id) DO UPDATE SET active = 1, removed_at = NULL`,
  ).run(briefId, sourceId, queuedAt);
  db.prepare(
    `INSERT INTO brief_pending_contents (brief_id, source_content_id, queued_at)
     SELECT ?, content.id, ?
     FROM source_contents AS content
     WHERE content.source_id = ?
     ON CONFLICT(brief_id, source_content_id) DO NOTHING`,
  ).run(briefId, queuedAt, sourceId);
}

const sourceSelection = `
  SELECT source.id, source.name, source.url, config.active,
    source.health_status, source.last_attempt_at, source.last_success_at, source.last_error,
    (SELECT COUNT(*) FROM brief_source_configurations AS usage
     WHERE usage.source_id = source.id AND usage.active = 1) AS used_by_brief_count,
    latest_run.status AS run_status, latest_run.new_content_count, latest_run.reused_content_count
  FROM brief_source_configurations AS config
  JOIN instance_sources AS source ON source.id = config.source_id
  LEFT JOIN source_acquisition_runs AS latest_run ON latest_run.id = (
    SELECT run.id FROM source_acquisition_runs AS run
    WHERE run.source_id = source.id ORDER BY run.started_at DESC LIMIT 1
  )
`;

function persistEntry(sourceId: string, entry: FeedEntry, acquiredAt: string): "created" | "reused" {
  const db = database();
  const contentHash = digest(JSON.stringify({
    externalId: entry.externalId,
    title: entry.title,
    body: entry.body,
    originUrl: entry.originUrl,
    publishedAt: entry.publishedAt,
  }));
  const existing = db.prepare(
    "SELECT id FROM source_contents WHERE source_id = ? AND content_hash = ?",
  ).get(sourceId, contentHash);
  if (existing) return "reused";

  db.prepare(
    `INSERT INTO source_contents
      (id, source_id, external_id, content_hash, title, body, origin_url,
       public_locator_url, public_locator_status, public_site_url,
       published_at, raw_json, acquired_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    digest(`${sourceId} ${contentHash}`),
    sourceId,
    entry.externalId,
    contentHash,
    entry.title,
    entry.body,
    entry.originUrl,
    entry.publicLocatorUrl,
    entry.publicLocatorStatus,
    entry.publicSiteUrl,
    entry.publishedAt,
    entry.rawPayload,
    acquiredAt,
  );
  return "created";
}

function listSourceContents(briefId: string, sourceId: string): SourceContent[] {
  const rows = database().prepare(
    `SELECT content.id, content.title, content.origin_url,
      content.published_at, content.acquired_at
     FROM brief_pending_contents AS queued
     JOIN source_contents AS content ON content.id = queued.source_content_id
     WHERE queued.brief_id = ? AND content.source_id = ?
     ORDER BY content.acquired_at DESC, content.id DESC`,
  ).all(briefId, sourceId) as ContentRow[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    originUrl: row.origin_url,
    publishedAt: row.published_at,
    acquiredAt: row.acquired_at,
  }));
}

function mapBriefSource(row: SourceRow, contents: SourceContent[]): BriefSource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    active: row.active === 1,
    healthStatus: row.health_status,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    usedByBriefCount: row.used_by_brief_count,
    latestRun: {
      status: row.run_status ?? "not_collected",
      newContentCount: row.new_content_count ?? 0,
      reusedContentCount: row.reused_content_count ?? 0,
      error: row.last_error,
    },
    contents,
  };
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
