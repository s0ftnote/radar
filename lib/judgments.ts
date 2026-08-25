import { randomUUID } from "node:crypto";
import { currentBriefRevision } from "@/lib/briefs";
import { database } from "@/lib/database";

export type PendingContent = {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  body: string;
  originUrl: string;
  publishedAt: string | null;
  acquiredAt: string;
};

export type Judgment = {
  id: string;
  briefRevisionId: string;
  sourceContentId: string;
  relevant: boolean;
  reason: string;
  createdAt: string;
  signals: JudgmentSignal[];
};

export type JudgmentSignal = {
  sourceContentId: string;
  sourceId: string;
  sourceName: string;
  title: string;
  originUrl: string;
};

export type RecordJudgmentInput = {
  sourceContentId: string;
  relevant: boolean;
  reason: string;
  signalContentIds?: string[];
};

type PendingRow = {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  body: string;
  origin_url: string;
  published_at: string | null;
  acquired_at: string;
};

type JudgmentRow = {
  id: string;
  brief_revision_id: string;
  source_content_id: string;
  relevant: number;
  reason: string;
  created_at: string;
};

type SignalRow = {
  judgment_id: string;
  source_content_id: string;
  source_id: string;
  source_name: string;
  title: string;
  origin_url: string;
};

/** 待判断队列：这个 Brief 已采集、还没有任何判断的来源内容。 */
export function listPendingContents(briefId: string): PendingContent[] {
  const rows = database().prepare(
    `SELECT content.id, content.source_id, source.name AS source_name, content.title,
      content.body, content.origin_url, content.published_at, content.acquired_at
     FROM brief_pending_contents AS queued
     JOIN source_contents AS content ON content.id = queued.source_content_id
     JOIN instance_sources AS source ON source.id = content.source_id
     WHERE queued.brief_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM judgments AS judged
         WHERE judged.brief_id = queued.brief_id
           AND judged.source_content_id = queued.source_content_id
       )
     ORDER BY queued.queued_at, content.id`,
  ).all(briefId) as PendingRow[];
  return rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    title: row.title,
    body: row.body,
    originUrl: row.origin_url,
    publishedAt: row.published_at,
    acquiredAt: row.acquired_at,
  }));
}

export function listJudgments(briefId: string): Judgment[] {
  const db = database();
  const rows = db.prepare(
    `SELECT id, brief_revision_id, source_content_id, relevant, reason, created_at
     FROM judgments WHERE brief_id = ? ORDER BY created_at DESC, id DESC`,
  ).all(briefId) as JudgmentRow[];
  const signals = db.prepare(
    `SELECT signal.judgment_id, signal.source_content_id, content.source_id,
      source.name AS source_name, content.title, content.origin_url
     FROM judgment_signals AS signal
     JOIN judgments AS judgment ON judgment.id = signal.judgment_id
     JOIN source_contents AS content ON content.id = signal.source_content_id
     JOIN instance_sources AS source ON source.id = content.source_id
     WHERE judgment.brief_id = ?
     ORDER BY content.acquired_at, content.id`,
  ).all(briefId) as SignalRow[];

  const byJudgment = new Map<string, JudgmentSignal[]>();
  for (const signal of signals) {
    const list = byJudgment.get(signal.judgment_id) ?? [];
    list.push({
      sourceContentId: signal.source_content_id,
      sourceId: signal.source_id,
      sourceName: signal.source_name,
      title: signal.title,
      originUrl: signal.origin_url,
    });
    byJudgment.set(signal.judgment_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    briefRevisionId: row.brief_revision_id,
    sourceContentId: row.source_content_id,
    relevant: row.relevant === 1,
    reason: row.reason,
    createdAt: row.created_at,
    signals: byJudgment.get(row.id) ?? [],
  }));
}

/**
 * 记录 Agent 对一份来源内容作出的一次判定。判断以这一次判定为身份：
 * Radar 只追加，不合并、不修订、不跨判断汇总。
 */
export function recordJudgment(briefId: string, input: RecordJudgmentInput): Judgment {
  const db = database();
  const revision = currentBriefRevision(briefId);
  const queued = db.prepare(
    `SELECT source_content_id FROM brief_pending_contents
     WHERE brief_id = ? AND source_content_id = ?`,
  ).get(briefId, input.sourceContentId);
  if (!queued) throw new Error("这份来源内容不在这个 Radar Brief 的待判断队列里。");

  const signalIds = [...new Set(input.signalContentIds ?? (input.relevant ? [input.sourceContentId] : []))];
  for (const signalId of signalIds) {
    const visible = db.prepare(
      `SELECT source_content_id FROM brief_pending_contents
       WHERE brief_id = ? AND source_content_id = ?`,
    ).get(briefId, signalId);
    if (!visible) throw new Error("判断引用的 Signal 不在这个 Radar Brief 的来源内容里。");
  }

  const judgmentId = randomUUID();
  const createdAt = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO judgments
        (id, brief_id, brief_revision_id, source_content_id, relevant, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      judgmentId,
      briefId,
      revision.id,
      input.sourceContentId,
      input.relevant ? 1 : 0,
      input.reason,
      createdAt,
    );
    for (const signalId of signalIds) {
      db.prepare(
        `INSERT INTO judgment_signals (judgment_id, source_content_id) VALUES (?, ?)`,
      ).run(judgmentId, signalId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return listJudgments(briefId).find((judgment) => judgment.id === judgmentId)!;
}
