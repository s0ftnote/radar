import { randomUUID } from "node:crypto";
import { database } from "./database.js";

export type RadarBrief = {
  id: string;
  name: string;
  createdAt: string;
  currentRevision: {
    id: string;
    number: number;
    description: string;
  };
};

type BriefRow = {
  id: string;
  name: string;
  created_at: string;
  revision_id: string;
  revision_number: number;
  description: string;
};

const briefSelection = `
  SELECT
    brief.id,
    brief.name,
    brief.created_at,
    revision.id AS revision_id,
    revision.revision_number,
    revision.description
  FROM radar_briefs AS brief
  JOIN radar_brief_revisions AS revision ON revision.brief_id = brief.id
  WHERE revision.revision_number = (
    SELECT MAX(current_revision.revision_number)
    FROM radar_brief_revisions AS current_revision
    WHERE current_revision.brief_id = brief.id
  )
`;

export function listBriefs(): RadarBrief[] {
  const rows = database()
    .prepare(`${briefSelection} ORDER BY brief.created_at DESC`)
    .all() as BriefRow[];
  return rows.map(mapBrief);
}

export function getBrief(id: string): RadarBrief | null {
  const row = database().prepare(`${briefSelection} AND brief.id = ?`).get(id) as
    | BriefRow
    | undefined;
  return row ? mapBrief(row) : null;
}

export function createBrief(input: { name: string; description: string }): RadarBrief {
  const db = database();
  const briefId = randomUUID();
  const revisionId = randomUUID();
  const createdAt = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO radar_briefs (id, name, created_at) VALUES (?, ?, ?)").run(
      briefId,
      input.name,
      createdAt,
    );
    db.prepare(
      `INSERT INTO radar_brief_revisions
        (id, brief_id, revision_number, description, created_at)
       VALUES (?, ?, 1, ?, ?)`,
    ).run(revisionId, briefId, input.description, createdAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    id: briefId,
    name: input.name,
    createdAt,
    currentRevision: {
      id: revisionId,
      number: 1,
      description: input.description,
    },
  };
}

export function currentBriefRevision(briefId: string): { id: string; description: string } {
  const row = database().prepare(
    `SELECT id, description FROM radar_brief_revisions
     WHERE brief_id = ? ORDER BY revision_number DESC LIMIT 1`,
  ).get(briefId) as { id: string; description: string } | undefined;
  if (!row) throw new Error("找不到这个 Radar Brief 的当前修订。");
  return row;
}

function mapBrief(row: BriefRow): RadarBrief {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    currentRevision: {
      id: row.revision_id,
      number: row.revision_number,
      description: row.description,
    },
  };
}
