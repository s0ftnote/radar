import { randomUUID } from "node:crypto";
import { database, inTransaction } from "./database.js";
import { RadarDomainError } from "./domain-error.js";
import { UnknownBriefError, getBrief } from "./briefs.js";
import { listJudgmentsByIds } from "./judgments.js";

export type Report = {
  id: string;
  briefId: string;
  title: string;
  body: string;
  generatedBy: string;
  judgmentIds: string[];
  createdAt: string;
};

type ReportRow = {
  id: string;
  brief_id: string;
  title: string;
  body: string;
  generated_by: string;
  created_at: string;
};

export function createReport(input: {
  briefId: string;
  title: string;
  body: string;
  generatedBy: string;
  judgmentIds: string[];
  idempotencyKey?: string;
}): Report {
  if (!getBrief(input.briefId)) throw new UnknownBriefError(input.briefId);
  const judgmentIds = [...new Set(input.judgmentIds)];
  if (judgmentIds.length === 0) {
    throw new RadarDomainError("报告至少要引用一条判断。", 400);
  }
  const judgments = listJudgmentsByIds(judgmentIds);
  if (
    judgments.length !== judgmentIds.length ||
    judgments.some((judgment) => judgment.briefId !== input.briefId)
  ) {
    throw new RadarDomainError("报告引用的判断必须全部来自这条 Radar Brief。", 400);
  }

  if (input.idempotencyKey) {
    const replayed = database()
      .prepare("SELECT id FROM reports WHERE brief_id = ? AND idempotency_key = ?")
      .get(input.briefId, input.idempotencyKey) as { id: string } | undefined;
    if (replayed) return getReport(replayed.id)!;
  }

  const reportId = randomUUID();
  const createdAt = new Date().toISOString();
  inTransaction(() => {
    database()
      .prepare(
        `INSERT INTO reports
          (id, brief_id, title, body, generated_by, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reportId,
        input.briefId,
        input.title,
        input.body,
        input.generatedBy,
        input.idempotencyKey ?? null,
        createdAt,
      );
    for (const judgmentId of judgmentIds) {
      database()
        .prepare("INSERT INTO report_judgments (report_id, judgment_id) VALUES (?, ?)")
        .run(reportId, judgmentId);
    }
  });
  return getReport(reportId)!;
}

export function getReport(id: string): Report | null {
  const row = database().prepare("SELECT * FROM reports WHERE id = ?").get(id) as
    | ReportRow
    | undefined;
  return row ? hydrate([row])[0]! : null;
}

export function listReports(briefId?: string): Report[] {
  const rows = briefId
    ? (database()
        .prepare("SELECT * FROM reports WHERE brief_id = ? ORDER BY created_at DESC, id DESC")
        .all(briefId) as ReportRow[])
    : (database()
        .prepare("SELECT * FROM reports ORDER BY created_at DESC, id DESC")
        .all() as ReportRow[]);
  return hydrate(rows);
}

function hydrate(rows: ReportRow[]): Report[] {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => "?").join(", ");
  const linked = database()
    .prepare(
      `SELECT report_id, judgment_id FROM report_judgments
       WHERE report_id IN (${placeholders}) ORDER BY report_id, judgment_id`,
    )
    .all(...rows.map((row) => row.id)) as Array<{ report_id: string; judgment_id: string }>;
  const byReport = new Map<string, string[]>();
  for (const link of linked) {
    const ids = byReport.get(link.report_id) ?? [];
    ids.push(link.judgment_id);
    byReport.set(link.report_id, ids);
  }
  return rows.map((row) => ({
    id: row.id,
    briefId: row.brief_id,
    title: row.title,
    body: row.body,
    generatedBy: row.generated_by,
    judgmentIds: byReport.get(row.id) ?? [],
    createdAt: row.created_at,
  }));
}
