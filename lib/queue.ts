import { randomUUID } from "node:crypto";
import { database, inTransaction } from "./database.js";
import { RadarDomainError } from "./domain-error.js";
import { instanceSetting, setInstanceSetting } from "./instance-settings.js";
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
    const fresh = db
      .prepare(
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
      )
      .all(endpoint.id, briefId) as Array<{ id: string }>;

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
         AND content.endpoint_id NOT IN (${excludedFromBriefSql("entry.brief_id")})`,
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
  const scored = scoreCandidates(
    briefId,
    listCandidates(briefId),
    strategy?.formula ?? defaultFormula,
  );

  // 第一步：整池按分数排定。同分时按内容 id，保证确定性。
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.content.sourceContentId.localeCompare(right.content.sourceContentId),
  );

  // 第二步：端点保底配额。配额约束的是「结果里每个端点至少占几条」，不是
  // 单条内容的分值（ADR 0010）——所以它只决定**谁进这一包**，进来之后照样
  // 按分数排。写成「按第几轮排」就把配额做成了均分：冷门端点的最低分内容
  // 会永远排在热门端点的最高分内容前面，分数退化成同轮内的 tie-breaker。
  const handedOut = withEndpointQuota(scored, limit);

  recordSignalHits(strategy?.id ?? defaultStrategyId, handedOut);
  return handedOut.map((item) => item.content);
}

/**
 * 每个有候选的端点先保底占一条，剩下的名额纯按分数发。取够之后整包再按分数
 * 排一次——配额决定谁进来，分数决定先看谁。
 */
const endpointQuota = 1;

function withEndpointQuota(scored: ScoredCandidate[], limit: number): ScoredCandidate[] {
  const taken = new Set<string>();
  const perEndpoint = new Map<string, number>();
  const picked: ScoredCandidate[] = [];

  // scored 已按分数排好，所以每个端点保底的那条就是它自己最高分的那条。
  for (const item of scored) {
    if (picked.length >= limit) break;
    const used = perEndpoint.get(item.content.endpointId) ?? 0;
    if (used >= endpointQuota) continue;
    perEndpoint.set(item.content.endpointId, used + 1);
    taken.add(item.content.queueEntryId);
    picked.push(item);
  }
  for (const item of scored) {
    if (picked.length >= limit) break;
    if (taken.has(item.content.queueEntryId)) continue;
    picked.push(item);
  }

  return picked.sort(
    (left, right) =>
      right.score - left.score ||
      left.content.sourceContentId.localeCompare(right.content.sourceContentId),
  );
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
           AND content.endpoint_id NOT IN (${excludedFromBriefSql("entry.brief_id")})`,
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

/**
 * 保留窗口。超过窗口仍没判断的内容**移出待判断队列，但不删除**（ADR 0010：
 * 只排序不丢弃）——关掉的代次留在库里，`radar requeue` 随时能把它回捞回来。
 * 不清扫队列只会一直涨：采集是持续的，判断是有限的。
 */
const retentionDaysKey = "queue_retention_days";
export const defaultRetentionDays = 30;

export function retentionDays(): number {
  const stored = instanceSetting(retentionDaysKey);
  return stored === null ? defaultRetentionDays : Number(stored);
}

export function setRetentionDays(days: number): number {
  if (!Number.isInteger(days) || days < 1) {
    throw new RadarDomainError("保留窗口要一个 1 天起的整数天数。", 400);
  }
  setInstanceSetting(retentionDaysKey, String(days));
  return days;
}

/** 关掉过了保留窗口还没判断的代次，返回这一次关掉几条。 */
export function sweepRetentionWindow(now = new Date()): number {
  const cutoff = new Date(now.getTime() - retentionDays() * 86_400_000).toISOString();
  return database()
    .prepare(
      `UPDATE queue_entries SET closed_at = ?, closed_because = 'retention_window'
       WHERE closed_at IS NULL AND queued_at < ?`,
    )
    .run(now.toISOString(), cutoff).changes as number;
}

export class NotQueuedBeforeError extends RadarDomainError {
  constructor(sourceContentId: string) {
    super(`这个 Brief 没有 ${sourceContentId} 的队列代次，回捞不了。`, 404);
  }
}

export class AlreadyPendingError extends RadarDomainError {
  constructor() {
    super("这条内容已经在待判断队列里了，不用回捞。", 409);
  }
}

/**
 * 显式回捞：给一条已经关掉的内容开一个**新的代次**。判过的重判、过了保留
 * 窗口被移出去的捞回来，走的都是这一条路——采集不会替用户做这个决定。
 */
export function requeueContent(
  briefId: string,
  sourceContentId: string,
): { queueEntryId: string; queuedAt: string } {
  const db = database();
  const entries = db
    .prepare("SELECT closed_at FROM queue_entries WHERE brief_id = ? AND source_content_id = ?")
    .all(briefId, sourceContentId) as Array<{ closed_at: string | null }>;
  if (entries.length === 0) throw new NotQueuedBeforeError(sourceContentId);
  if (entries.some((entry) => entry.closed_at === null)) throw new AlreadyPendingError();

  const queueEntryId = randomUUID();
  const queuedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO queue_entries (id, brief_id, source_content_id, queued_at) VALUES (?, ?, ?, ?)",
  ).run(queueEntryId, briefId, sourceContentId, queuedAt);
  return { queueEntryId, queuedAt };
}

/**
 * 取数角色要的两个机械事实：队列还有多深、最近一次判断是什么时候（#44）。
 * 都是 Radar 数得出来的数，不含任何判断。
 */
export function queueStatus(briefId: string): {
  queueDepth: number;
  lastJudgedAt: string | null;
  retentionDays: number;
} {
  const judged = database()
    .prepare("SELECT MAX(created_at) AS last FROM judgments WHERE brief_id = ?")
    .get(briefId) as { last: string | null };
  return {
    queueDepth: queueDepth(briefId),
    lastJudgedAt: judged.last,
    retentionDays: retentionDays(),
  };
}
