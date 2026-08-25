import { randomUUID } from "node:crypto";
import { database, inTransaction } from "./database.js";

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

export function currentBriefRevision(briefId: string): BriefRevision {
  const brief = getBrief(briefId);
  if (!brief) throw new Error("找不到这个 Radar Brief。");
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
