import { randomUUID } from "node:crypto";
import { database, inTransaction } from "./database.js";
import { RadarDomainError } from "./domain-error.js";

export class UnknownBriefError extends RadarDomainError {
  constructor(briefId: string) {
    super(`找不到 Radar Brief ${briefId}。`, 404);
  }
}

export type BriefRevision = {
  id: string;
  number: number;
  body: string;
  rationale: string | null;
  createdAt: string;
};

export type Brief = {
  id: string;
  name: string;
  createdAt: string;
  currentRevision: BriefRevision;
};

type BriefRow = {
  id: string;
  name: string;
  created_at: string;
  revision_id: string;
  revision_number: number;
  body: string;
  rationale: string | null;
  revision_created_at: string;
};

const briefSelection = `
  SELECT brief.id, brief.name, brief.created_at,
    revision.id AS revision_id, revision.revision_number, revision.body,
    revision.rationale, revision.created_at AS revision_created_at
  FROM briefs AS brief
  JOIN brief_revisions AS revision ON revision.brief_id = brief.id
  WHERE revision.revision_number = (
    SELECT MAX(latest.revision_number) FROM brief_revisions AS latest
    WHERE latest.brief_id = brief.id
  )
    AND brief.archived_at IS NULL
`;

export function listBriefs(): Brief[] {
  return (
    database().prepare(`${briefSelection} ORDER BY brief.created_at DESC`).all() as BriefRow[]
  ).map(mapBrief);
}

export function getBrief(id: string): Brief | null {
  const row = database().prepare(`${briefSelection} AND brief.id = ?`).get(id) as
    | BriefRow
    | undefined;
  return row ? mapBrief(row) : null;
}

export function createBrief(input: { name: string; body: string }): Brief {
  const briefId = randomUUID();
  const createdAt = new Date().toISOString();
  const db = database();

  inTransaction(() => {
    db.prepare("INSERT INTO briefs (id, name, created_at) VALUES (?, ?, ?)").run(
      briefId,
      input.name,
      createdAt,
    );
    db.prepare(
      `INSERT INTO brief_revisions (id, brief_id, revision_number, body, rationale, created_at)
       VALUES (?, ?, 1, ?, NULL, ?)`,
    ).run(randomUUID(), briefId, input.body, createdAt);
  });

  return getBrief(briefId)!;
}

/**
 * 改 Brief 正文形成一条新修订。当前版本与历史版本同时保留，`rationale` 记下
 * 这次改动的依据——用户随口改主意也要留得下追溯。
 */
export function reviseBrief(input: {
  briefId: string;
  body: string;
  rationale: string;
}): Brief {
  inTransaction(() => {
    appendBriefRevision(input);
  });
  return getBrief(input.briefId)!;
}

export function updateBrief(input: {
  briefId: string;
  name: string;
  body: string;
  rationale: string;
}): Brief {
  const current = getBrief(input.briefId);
  if (!current) throw new UnknownBriefError(input.briefId);

  inTransaction(() => {
    database().prepare("UPDATE briefs SET name = ? WHERE id = ?").run(input.name, input.briefId);
    if (input.body === current.currentRevision.body) return;
    appendBriefRevision(input);
  });

  return getBrief(input.briefId)!;
}

/** 从工作台移除一条任务；Brief、判断、报告与交付历史原样保留。 */
export function archiveBrief(briefId: string): void {
  if (!getBrief(briefId)) throw new UnknownBriefError(briefId);
  database()
    .prepare("UPDATE briefs SET archived_at = ? WHERE id = ? AND archived_at IS NULL")
    .run(new Date().toISOString(), briefId);
}

/** Brief 的全部修订，新的在前。历史版本不删——改主意要留得下追溯。 */
export function listBriefRevisions(briefId: string): BriefRevision[] {
  return (
    database()
      .prepare(
        `SELECT id, revision_number, body, rationale, created_at
         FROM brief_revisions WHERE brief_id = ? ORDER BY revision_number DESC`,
      )
      .all(briefId) as Array<{
      id: string;
      revision_number: number;
      body: string;
      rationale: string | null;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    number: row.revision_number,
    body: row.body,
    rationale: row.rationale,
    createdAt: row.created_at,
  }));
}

export function currentBriefRevision(briefId: string): BriefRevision {
  const brief = getBrief(briefId);
  if (!brief) throw new UnknownBriefError(briefId);
  return brief.currentRevision;
}

function mapBrief(row: BriefRow): Brief {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    currentRevision: {
      id: row.revision_id,
      number: row.revision_number,
      body: row.body,
      rationale: row.rationale,
      createdAt: row.revision_created_at,
    },
  };
}

function appendBriefRevision(input: {
  briefId: string;
  body: string;
  rationale: string;
}): void {
  const db = database();
  const latest = (db
    .prepare("SELECT MAX(revision_number) AS latest FROM brief_revisions WHERE brief_id = ?")
    .get(input.briefId) as { latest: number | null }).latest;
  if (latest === null) throw new UnknownBriefError(input.briefId);
  db.prepare(
    `INSERT INTO brief_revisions (id, brief_id, revision_number, body, rationale, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.briefId,
    latest + 1,
    input.body,
    input.rationale,
    new Date().toISOString(),
  );
}
