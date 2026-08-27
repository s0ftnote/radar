import { randomUUID } from "node:crypto";
import { currentBriefRevision } from "./briefs.js";
import { database, inTransaction } from "./database.js";
import { groupBy } from "./group-by.js";
import { RadarDomainError } from "./domain-error.js";
import { getOpenQueueEntry } from "./queue.js";

export type JudgmentSignal = {
  sourceContentId: string;
  endpointId: string;
  endpointName: string;
  title: string;
  originUrl: string;
};

export type Judgment = {
  id: string;
  briefId: string;
  briefRevisionId: string;
  queueEntryId: string;
  sourceContentId: string;
  relevant: boolean;
  /** 四块给用户的说明。判不相关时前三块留空，whyForYou 变成淘汰理由，照样必填。 */
  whatItIs: string;
  evidence: string;
  uncertainty: string;
  /** Agent 从这份内容本身提取的文档级标签，不是采集端点的 topics。 */
  tags: string[];
  whyForYou: string;
  judgedBy: string;
  createdAt: string;
  signals: JudgmentSignal[];
  relatedJudgmentIds: string[];
};

export type RecordJudgmentInput = {
  queueEntryId: string;
  relevant: boolean;
  whatItIs?: string;
  evidence?: string;
  uncertainty?: string;
  tags?: string[];
  whyForYou: string;
  judgedBy: string;
  signalContentIds?: string[];
  /** Agent 自报的关联：这条判断跟哪几条讲的是同一件事。Radar 只记不判断。 */
  relatedJudgmentIds?: string[];
  /** 防同一调用者的网络重试；重复判断由队列代次挡下，不靠这个。 */
  idempotencyKey?: string;
};

export class UnknownJudgmentError extends RadarDomainError {
  constructor(judgmentId: string) {
    super(`找不到判断 ${judgmentId}。`, 404);
  }
}

export class QueueEntryConsumedError extends RadarDomainError {
  constructor() {
    super("这个队列代次已经判过了。要重判须显式回捞，那会开一个新的代次。", 409);
  }
}

type JudgmentRow = {
  id: string;
  brief_id: string;
  brief_revision_id: string;
  queue_entry_id: string;
  source_content_id: string;
  relevant: number;
  what_it_is: string;
  evidence: string;
  uncertainty: string;
  tags: string;
  why_for_you: string;
  judged_by: string;
  created_at: string;
};

/**
 * 写回一次判定。队列代次的消费与判断的写入在同一个事务里——代次的唯一约束
 * 就是挡下重复写回的那道门。
 */
export function recordJudgment(input: RecordJudgmentInput): Judgment {
  const db = database();

  if (input.idempotencyKey) {
    const replayed = db
      .prepare("SELECT judgment_id FROM idempotent_judgments WHERE key = ?")
      .get(input.idempotencyKey) as { judgment_id: string } | undefined;
    if (replayed) return getJudgment(replayed.judgment_id)!;
  }

  const entry = getOpenQueueEntry(input.queueEntryId);
  if (!entry) throw new QueueEntryConsumedError();

  const revision = currentBriefRevision(entry.briefId);
  const signalIds = [
    ...new Set(input.signalContentIds ?? (input.relevant ? [entry.sourceContentId] : [])),
  ];
  for (const signalId of signalIds) assertQueuedInBrief(entry.briefId, signalId);

  const judgmentId = randomUUID();
  const createdAt = new Date().toISOString();

  inTransaction(() => {
    const consumed = db
      .prepare(
        `UPDATE queue_entries SET closed_at = ?, closed_because = 'judged'
         WHERE id = ? AND closed_at IS NULL`,
      )
      .run(createdAt, entry.id);
    if (consumed.changes === 0) throw new QueueEntryConsumedError();

    db.prepare(
      `INSERT INTO judgments
        (id, brief_id, brief_revision_id, queue_entry_id, source_content_id, relevant,
         what_it_is, evidence, uncertainty, tags, why_for_you, judged_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      judgmentId,
      entry.briefId,
      revision.id,
      entry.id,
      entry.sourceContentId,
      input.relevant ? 1 : 0,
      input.relevant ? (input.whatItIs ?? "") : "",
      input.relevant ? (input.evidence ?? "") : "",
      input.relevant ? (input.uncertainty ?? "") : "",
      JSON.stringify(normalizeTags(input.tags)),
      input.whyForYou,
      input.judgedBy,
      createdAt,
    );

    for (const signalId of signalIds) {
      db.prepare("INSERT INTO judgment_signals (judgment_id, source_content_id) VALUES (?, ?)").run(
        judgmentId,
        signalId,
      );
    }
    // Agent 自报的关联，双向都记一条——取材时顺着链走，方向无所谓。
    for (const relatedId of new Set(input.relatedJudgmentIds ?? [])) {
      if (relatedId === judgmentId) continue;
      // 只能挂同一条 Brief 里的判断——判断归属单个 Brief，关联也不能跨过去
      // （ADR 0007）。跨 Brief 的 id 就当不存在。
      const related = getJudgment(relatedId);
      if (!related || related.briefId !== entry.briefId) {
        throw new UnknownJudgmentError(relatedId);
      }
      db.prepare(
        `INSERT INTO judgment_relations (judgment_id, related_judgment_id) VALUES (?, ?)
         ON CONFLICT DO NOTHING`,
      ).run(judgmentId, relatedId);
    }
    if (input.idempotencyKey) {
      db.prepare(
        "INSERT INTO idempotent_judgments (key, judgment_id, created_at) VALUES (?, ?, ?)",
      ).run(input.idempotencyKey, judgmentId, createdAt);
    }
  });

  return getJudgment(judgmentId)!;
}

export function getJudgment(id: string): Judgment | null {
  const row = database().prepare("SELECT * FROM judgments WHERE id = ?").get(id) as
    JudgmentRow | undefined;
  return row ? hydrate([row])[0]! : null;
}

export function listJudgments(briefId: string): Judgment[] {
  return hydrate(
    database()
      .prepare("SELECT * FROM judgments WHERE brief_id = ? ORDER BY created_at DESC, id DESC")
      .all(briefId) as JudgmentRow[],
  );
}

/** 按 id 取一组判断，保持传进来的顺序——取材那边已经排好序了。 */
export function listJudgmentsByIds(ids: string[]): Judgment[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const byId = new Map(
    hydrate(
      database()
        .prepare(`SELECT * FROM judgments WHERE id IN (${placeholders})`)
        .all(...ids) as JudgmentRow[],
    ).map((judgment) => [judgment.id, judgment]),
  );
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** 工作包里的「最近判断的紧凑清单」：只有标题与相关与否，用来认出已经判过的同一件事。 */
export function listRecentJudgmentSummaries(
  briefId: string,
  limit: number,
): Array<{ id: string; title: string; relevant: boolean; createdAt: string }> {
  return (
    database()
      .prepare(
        `SELECT judgment.id, content.title, judgment.relevant, judgment.created_at
       FROM judgments AS judgment
       JOIN source_contents AS content ON content.id = judgment.source_content_id
       WHERE judgment.brief_id = ?
       ORDER BY judgment.created_at DESC, judgment.id DESC
       LIMIT ?`,
      )
      .all(briefId, limit) as Array<{
      id: string;
      title: string;
      relevant: number;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    title: row.title,
    relevant: row.relevant === 1,
    createdAt: row.created_at,
  }));
}

/** 引用得了的 Signal，是这个 Brief 曾经入过队的内容——判过的照样可以再被引用。 */
function assertQueuedInBrief(briefId: string, sourceContentId: string): void {
  const queued = database()
    .prepare("SELECT 1 FROM queue_entries WHERE brief_id = ? AND source_content_id = ?")
    .get(briefId, sourceContentId);
  if (!queued) {
    throw new RadarDomainError("判断引用的 Signal 不在这个 Radar Brief 的来源内容里。", 400);
  }
}

/** Signal 与关联各取一次，不按判断条数发查询。 */
function hydrate(rows: JudgmentRow[]): Judgment[] {
  if (rows.length === 0) return [];
  const db = database();
  const placeholders = rows.map(() => "?").join(", ");
  const ids = rows.map((row) => row.id);

  const signals = db
    .prepare(
      `SELECT signal.judgment_id, signal.source_content_id, content.endpoint_id,
      endpoint.name AS endpoint_name, content.title, content.origin_url
     FROM judgment_signals AS signal
     JOIN source_contents AS content ON content.id = signal.source_content_id
     JOIN endpoints AS endpoint ON endpoint.id = content.endpoint_id
     WHERE signal.judgment_id IN (${placeholders})
     ORDER BY content.acquired_at, content.id`,
    )
    .all(...ids) as Array<{
    judgment_id: string;
    source_content_id: string;
    endpoint_id: string;
    endpoint_name: string;
    title: string;
    origin_url: string;
  }>;

  const relations = db
    .prepare(
      `SELECT judgment_id, related_judgment_id FROM judgment_relations
     WHERE judgment_id IN (${placeholders}) ORDER BY related_judgment_id`,
    )
    .all(...ids) as Array<{ judgment_id: string; related_judgment_id: string }>;

  const signalsByJudgment = groupBy(signals, (signal) => signal.judgment_id);
  const relationsByJudgment = groupBy(relations, (relation) => relation.judgment_id);

  return rows.map((row) => ({
    id: row.id,
    briefId: row.brief_id,
    briefRevisionId: row.brief_revision_id,
    queueEntryId: row.queue_entry_id,
    sourceContentId: row.source_content_id,
    relevant: row.relevant === 1,
    whatItIs: row.what_it_is,
    evidence: row.evidence,
    uncertainty: row.uncertainty,
    tags: parseTags(row.tags),
    whyForYou: row.why_for_you,
    judgedBy: row.judged_by,
    createdAt: row.created_at,
    signals: (signalsByJudgment.get(row.id) ?? []).map((signal) => ({
      sourceContentId: signal.source_content_id,
      endpointId: signal.endpoint_id,
      endpointName: signal.endpoint_name,
      title: signal.title,
      originUrl: signal.origin_url,
    })),
    relatedJudgmentIds: (relationsByJudgment.get(row.id) ?? []).map(
      (relation) => relation.related_judgment_id,
    ),
  }));
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function parseTags(raw: string): string[] {
  const value = JSON.parse(raw) as unknown;
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string")
    : [];
}
