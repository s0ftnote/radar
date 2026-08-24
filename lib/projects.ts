import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";

export type RadarProject = {
  id: string;
  name: string;
  createdAt: string;
  briefId: string;
  briefRevision: number;
  briefDescription: string;
};

type ProjectRow = {
  id: string;
  name: string;
  created_at: string;
  brief_id: string;
  revision_number: number;
  description: string;
};

const projectSelection = `
  SELECT
    project.id,
    project.name,
    project.created_at,
    brief.id AS brief_id,
    brief.revision_number,
    brief.description
  FROM radar_projects AS project
  JOIN radar_brief_revisions AS brief ON brief.project_id = project.id
  WHERE brief.revision_number = (
    SELECT MAX(current_brief.revision_number)
    FROM radar_brief_revisions AS current_brief
    WHERE current_brief.project_id = project.id
  )
`;

export function listProjects(): RadarProject[] {
  const rows = database()
    .prepare(`${projectSelection} ORDER BY project.created_at DESC`)
    .all() as ProjectRow[];
  return rows.map(mapProject);
}

export function getProject(id: string): RadarProject | null {
  const row = database().prepare(`${projectSelection} AND project.id = ?`).get(id) as
    | ProjectRow
    | undefined;
  return row ? mapProject(row) : null;
}

export function createProject(input: { name: string; brief: string }): RadarProject {
  const db = database();
  const projectId = randomUUID();
  const briefId = randomUUID();
  const createdAt = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO radar_projects (id, name, created_at) VALUES (?, ?, ?)").run(
      projectId,
      input.name,
      createdAt,
    );
    db.prepare(
      `INSERT INTO radar_brief_revisions
        (id, project_id, revision_number, description, created_at)
       VALUES (?, ?, 1, ?, ?)`,
    ).run(briefId, projectId, input.brief, createdAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    id: projectId,
    name: input.name,
    createdAt,
    briefId,
    briefRevision: 1,
    briefDescription: input.brief,
  };
}

function mapProject(row: ProjectRow): RadarProject {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    briefId: row.brief_id,
    briefRevision: row.revision_number,
    briefDescription: row.description,
  };
}
