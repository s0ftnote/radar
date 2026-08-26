import { randomUUID } from "node:crypto";
import { database, inTransaction } from "./database.js";
import { excludedFromBriefSql, listEndpointsToEnqueue } from "./endpoints.js";
import {
  scoreCandidates,
  type CandidateRow,
  type PendingContent,
  type ScoredCandidate,
} from "./scoring.js";
export type { PendingContent };
import { currentStrategy, defaultFormula, defaultStrategyId } from "./strategy.js";

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

  for (const endpoint of listEndpointsToEnqueue()) {
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
    .prepare(
      `SELECT COUNT(*) AS depth FROM queue_entries AS entry
       JOIN source_contents AS content ON content.id = entry.source_content_id
       WHERE entry.brief_id = ? AND entry.closed_at IS NULL
         AND content.endpoint_id NOT IN (${excludedFromBriefSql('entry.brief_id')})`,
    )
    .get(briefId) as { depth: number };
  return row.depth;
}

/**
 * 被这个 Brief 排除掉的端点不出现在待判断里——排除是「这个 Brief 不看它」。
 * 代次本身不删（ADR 0010：只排序不丢弃），重新纳入时它们照样回来。
 *
 * 排序是**两步**：先按策略给每条算分，**再做一层确定性的端点轮转**。轮转由
 * Radar 固定实现、对所有 Brief 一致，不进策略——配额是跨端点的合并约束，
 * 不是单条内容的分值。
 */
export function listPendingContents(briefId: string, limit: number): PendingContent[] {
  const strategy = currentStrategy(briefId);
  // 整条队列都参与算分，不先按新鲜度砍一刀——那样一条老内容再高的分也永远
  // 浮不上来，那就是丢弃，不是排序（ADR 0010）。
  const scored = scoreCandidates(briefId, listCandidates(briefId), strategy?.formula ?? defaultFormula);

  // 第一步的结果：先把整池按分数排定。同分时按内容 id，保证确定性。
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.content.sourceContentId.localeCompare(right.content.sourceContentId),
  );

  // 第二步：确定性端点轮转。每个端点按它在上面那个排名里的次序编号，
  // 再按「第几轮、分数」排——一个端点就不会连着霸占开头。
  const rotation = new Map<string, number>();
  for (const item of scored) {
    const round = (rotation.get(item.content.endpointId) ?? 0) + 1;
    rotation.set(item.content.endpointId, round);
    item.round = round;
  }
  scored.sort(
    (left, right) =>
      left.round - right.round ||
      right.score - left.score ||
      left.content.sourceContentId.localeCompare(right.content.sourceContentId),
  );

  const handedOut = scored.slice(0, limit);
  recordSignalHits(strategy?.id ?? defaultStrategyId, handedOut);
  return handedOut.map((item) => item.content);
}

function listCandidates(briefId: string): CandidateRow[] {
  return database()
    .prepare(
      `SELECT entry.id AS queue_entry_id, entry.queued_at, content.id AS source_content_id,
           content.endpoint_id, endpoint.name AS endpoint_name, content.title, content.body,
           content.origin_url, content.published_at, content.acquired_at,
           COALESCE(hot.hotness, 0) AS hotness
         FROM queue_entries AS entry
         JOIN source_contents AS content ON content.id = entry.source_content_id
         JOIN endpoints AS endpoint ON endpoint.id = content.endpoint_id
         LEFT JOIN source_content_hotness AS hot ON hot.source_content_id = content.id
         WHERE entry.brief_id = ? AND entry.closed_at IS NULL
           AND content.endpoint_id NOT IN (${excludedFromBriefSql('entry.brief_id')})`,
    )
    .all(briefId) as CandidateRow[];
}

/** 这一包里每条内容是靠哪几条信号得的分。纯计数的记账，不读内容。 */
function recordSignalHits(strategyId: string, items: ScoredCandidate[]): void {
  const db = database();
  inTransaction(() => {
    for (const item of items) {
      for (const [signal, contribution] of Object.entries(item.contributions)) {
        if (contribution === 0) continue;
        db.prepare(
          `INSERT INTO queue_entry_signals (queue_entry_id, strategy_id, signal, contribution)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(queue_entry_id, strategy_id, signal) DO UPDATE SET
             contribution = excluded.contribution`,
        ).run(item.content.queueEntryId, strategyId, signal, contribution);
      }
    }
  });
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

