import { randomUUID } from "node:crypto";
import { database } from "./database.js";
import { listEndpointsVisibleToBrief } from "./endpoints.js";

export type PendingContent = {
  /** 不可变的队列代次 id。`radar judge` 消费它，代次唯一约束挡下重复写回。 */
  queueEntryId: string;
  sourceContentId: string;
  endpointId: string;
  endpointName: string;
  title: string;
  body: string;
  originUrl: string;
  publishedAt: string | null;
  acquiredAt: string;
  queuedAt: string;
};

type PendingRow = {
  queue_entry_id: string;
  source_content_id: string;
  endpoint_id: string;
  endpoint_name: string;
  title: string;
  body: string;
  origin_url: string;
  published_at: string | null;
  acquired_at: string;
  queued_at: string;
};

/**
 * 把端点「当前一页」上这个 Brief 从没入过队的内容入队。
 *
 * 从没入过队是关键：判过的内容不会因为下一次采集又冒出来，重判须显式回捞——
 * 那会开一个新的代次。当前一页而不是全部历史：Brief 在端点之后创建时，
 * 不该被回填该端点的整段历史。
 */
export function enqueueCurrentPage(briefId: string): number {
  const db = database();
  const queuedAt = new Date().toISOString();
  let queued = 0;

  for (const endpoint of listEndpointsVisibleToBrief(briefId)) {
    const fresh = db.prepare(
      `SELECT content.id FROM source_contents AS content
       WHERE content.endpoint_id = ?
         AND content.last_seen_at >= COALESCE((
           SELECT run.started_at FROM acquisition_runs AS run
           WHERE run.endpoint_id = content.endpoint_id AND run.status = 'success'
           ORDER BY run.started_at DESC LIMIT 1
         ), content.last_seen_at)
         AND NOT EXISTS (
           SELECT 1 FROM queue_entries AS queued
           WHERE queued.brief_id = ? AND queued.source_content_id = content.id
         )`,
    ).all(endpoint.id, briefId) as Array<{ id: string }>;

    for (const content of fresh) {
      db.prepare(
        `INSERT INTO queue_entries (id, brief_id, source_content_id, queued_at)
         VALUES (?, ?, ?, ?)`,
      ).run(randomUUID(), briefId, content.id, queuedAt);
      queued += 1;
    }
  }
  return queued;
}

/** 一次采集之后，所有 Brief 都跟着入队。 */
export function enqueueForAllBriefs(): number {
  const briefIds = database().prepare("SELECT id FROM briefs").all() as Array<{ id: string }>;
  return briefIds.reduce((total, brief) => total + enqueueCurrentPage(brief.id), 0);
}

export function queueDepth(briefId: string): number {
  const row = database()
    .prepare("SELECT COUNT(*) AS depth FROM queue_entries WHERE brief_id = ? AND closed_at IS NULL")
    .get(briefId) as { depth: number };
  return row.depth;
}

/**
 * 默认排序：纯新鲜度，再加一层确定性的端点轮转（修正后的 ADR 0010）。
 * 轮转由 Radar 固定实现、对所有 Brief 一致，不进排队策略——配额是跨端点的
 * 合并约束，不是单条内容的分值。
 *
 * 两步都下推到 SQL：队列按设计会无限增长，不能先全量捞出来再在内存里切。
 * 每个端点各按新鲜度编号，再按「第几轮、端点 id」排——那就是轮转。
 */
export function listPendingContents(briefId: string, limit: number): PendingContent[] {
  const rows = database().prepare(
    `WITH ranked AS (
       SELECT entry.id AS queue_entry_id, entry.queued_at, content.id AS source_content_id,
         content.endpoint_id, endpoint.name AS endpoint_name, content.title, content.body,
         content.origin_url, content.published_at, content.acquired_at,
         COALESCE(content.published_at, content.acquired_at) AS freshness,
         ROW_NUMBER() OVER (
           PARTITION BY content.endpoint_id
           ORDER BY COALESCE(content.published_at, content.acquired_at) DESC, content.id
         ) AS rotation
       FROM queue_entries AS entry
       JOIN source_contents AS content ON content.id = entry.source_content_id
       JOIN endpoints AS endpoint ON endpoint.id = content.endpoint_id
       WHERE entry.brief_id = ? AND entry.closed_at IS NULL
     )
     -- 两步：先按纯新鲜度排，再套一层确定性端点轮转。轮次之内仍然是新鲜度说了算，
     -- 轮转只保证一个端点不会连着霸占开头（ADR 0010）。
     SELECT * FROM ranked WHERE rotation <= ?
     ORDER BY rotation, freshness DESC, source_content_id LIMIT ?`,
  ).all(briefId, limit, limit) as PendingRow[];

  return rows.map(mapPending);
}

export function getOpenQueueEntry(
  queueEntryId: string,
): { id: string; briefId: string; sourceContentId: string } | null {
  const row = database()
    .prepare(
      "SELECT id, brief_id, source_content_id FROM queue_entries WHERE id = ? AND closed_at IS NULL",
    )
    .get(queueEntryId) as { id: string; brief_id: string; source_content_id: string } | undefined;
  return row ? { id: row.id, briefId: row.brief_id, sourceContentId: row.source_content_id } : null;
}

function mapPending(row: PendingRow): PendingContent {
  return {
    queueEntryId: row.queue_entry_id,
    sourceContentId: row.source_content_id,
    endpointId: row.endpoint_id,
    endpointName: row.endpoint_name,
    title: row.title,
    body: row.body,
    originUrl: row.origin_url,
    publishedAt: row.published_at,
    acquiredAt: row.acquired_at,
    queuedAt: row.queued_at,
  };
}
