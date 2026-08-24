import { createHash, randomUUID } from "node:crypto";
import { configuredRadarAgent, type AgentJudgment, type AgentJudgmentInput, type RadarAgent } from "@/lib/agent";
import { database } from "@/lib/database";

export type JudgmentBatchResult = {
  matched: number;
  noMatch: number;
  failed: number;
  reused: number;
  inProgress: number;
};

export type JudgmentRunView = {
  id: string;
  status: "running" | "success" | "failed";
  outcome: "matched" | "no_match" | null;
  reason: string | null;
  error: string | null;
  sourceVersionId: string;
  sourceTitle: string;
  sourceVersionNumber: number;
  briefRevisionId: string;
  startedAt: string;
  completedAt: string | null;
};

export type IntelligenceItemView = {
  id: string;
  title: string;
  judgment: string;
  rationale: string;
  revisionNumber: number;
  createdAt: string;
  evidence: IntelligenceEvidenceView[];
};

export type IntelligenceEvidenceView = {
  signalId: string;
  briefRevisionId: string;
  sourceVersionId: string;
  sourceVersionNumber: number;
  sourceTitle: string;
  sourceBody: string;
  sourceOriginUrl: string;
  evidenceQuote: string;
  evidenceLocator: string;
};

export type IntelligenceWorkspace = {
  sourceVersionCount: number;
  runs: JudgmentRunView[];
  items: IntelligenceItemView[];
};

type BriefRow = { id: string; description: string };
type SourceVersionRow = {
  id: string;
  version_number: number;
  title: string;
  body: string;
  origin_url: string;
  published_at: string | null;
  acquired_at: string;
};
type RunRow = {
  id: string;
  status: JudgmentRunView["status"];
  outcome: JudgmentRunView["outcome"];
  reason: string | null;
  error: string | null;
  source_version_id: string;
  source_title: string;
  source_version_number: number;
  brief_revision_id: string;
  started_at: string;
  completed_at: string | null;
};
type ItemRow = {
  id: string;
  title: string;
  judgment: string;
  rationale: string;
  revision_number: number;
  signal_id: string;
  brief_revision_id: string;
  source_version_id: string;
  source_version_number: number;
  source_title: string;
  source_body: string;
  source_origin_url: string;
  evidence_quote: string;
  evidence_locator: string;
  created_at: string;
};

export async function runProjectJudgment(
  projectId: string,
  agent: RadarAgent = configuredRadarAgent(),
): Promise<JudgmentBatchResult> {
  const brief = currentBrief(projectId);
  const versions = projectSourceVersions(projectId);
  const result: JudgmentBatchResult = { matched: 0, noMatch: 0, failed: 0, reused: 0, inProgress: 0 };

  for (const version of versions) {
    const claim = claimRun(projectId, brief.id, version.id, agent.kind);
    if (claim.kind === "reused") {
      result.reused += 1;
      continue;
    }
    if (claim.kind === "in_progress") {
      result.inProgress += 1;
      continue;
    }

    try {
      const judgment = await agent.judge(agentInput(brief, version));
      if (judgment.match) {
        persistMatch(claim.runId, projectId, brief.id, version.id, judgment);
        result.matched += 1;
      } else {
        completeNoMatch(claim.runId, judgment.reason);
        result.noMatch += 1;
      }
    } catch (error) {
      failRun(claim.runId, error instanceof Error ? error.message : "Agent 调用失败，可以重试。");
      result.failed += 1;
    }
  }
  return result;
}

export function getIntelligenceWorkspace(projectId: string): IntelligenceWorkspace {
  const db = database();
  const sourceVersionCount = db.prepare(
    `SELECT COUNT(*) AS count
     FROM project_source_configurations AS config
     JOIN source_contents AS content ON content.source_id = config.source_id
     JOIN source_versions AS version ON version.content_id = content.id
     WHERE config.project_id = ?`,
  ).get(projectId) as { count: number };
  const runs = db.prepare(
    `SELECT run.id, run.status, run.outcome, run.reason, run.error,
      run.source_version_id, version.title AS source_title,
      version.version_number AS source_version_number, run.brief_revision_id,
      run.started_at, run.completed_at
     FROM agent_runs AS run
     JOIN source_versions AS version ON version.id = run.source_version_id
     WHERE run.project_id = ?
     ORDER BY run.started_at DESC`,
  ).all(projectId) as RunRow[];
  const items = db.prepare(
    `SELECT item.id, revision.title, revision.judgment, revision.rationale,
      revision.revision_number, signal.id AS signal_id, signal.brief_revision_id,
      signal.source_version_id, version.version_number AS source_version_number,
      version.title AS source_title, version.body AS source_body,
      version.origin_url AS source_origin_url, signal.evidence_quote,
      signal.evidence_locator, revision.created_at
     FROM intelligence_items AS item
     JOIN intelligence_item_revisions AS revision ON revision.intelligence_item_id = item.id
     JOIN intelligence_item_signals AS item_signal ON item_signal.intelligence_item_id = item.id
     JOIN signals AS signal ON signal.id = item_signal.signal_id
     JOIN source_versions AS version ON version.id = signal.source_version_id
     WHERE item.project_id = ? AND revision.revision_number = 1
     ORDER BY item.created_at DESC`,
  ).all(projectId) as ItemRow[];
  return {
    sourceVersionCount: sourceVersionCount.count,
    runs: runs.map(mapRun),
    items: groupItems(items),
  };
}

function currentBrief(projectId: string): BriefRow {
  const row = database().prepare(
    `SELECT id, description FROM radar_brief_revisions
     WHERE project_id = ? ORDER BY revision_number DESC LIMIT 1`,
  ).get(projectId) as BriefRow | undefined;
  if (!row) throw new Error("找不到当前 Radar Brief 修订。");
  return row;
}

function projectSourceVersions(projectId: string): SourceVersionRow[] {
  return database().prepare(
    `SELECT version.id, version.version_number, version.title, version.body,
      version.origin_url, version.published_at, version.acquired_at
     FROM project_source_configurations AS config
     JOIN source_contents AS content ON content.source_id = config.source_id
     JOIN source_versions AS version ON version.content_id = content.id
     WHERE config.project_id = ?
     ORDER BY version.acquired_at, version.id`,
  ).all(projectId) as SourceVersionRow[];
}

function claimRun(
  projectId: string,
  briefRevisionId: string,
  sourceVersionId: string,
  adapterKind: string,
): { kind: "claimed"; runId: string } | { kind: "reused" } | { kind: "in_progress" } {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare(
      `SELECT status FROM agent_runs
       WHERE project_id = ? AND brief_revision_id = ? AND source_version_id = ?
         AND status IN ('running', 'success')
       ORDER BY started_at DESC LIMIT 1`,
    ).get(projectId, briefRevisionId, sourceVersionId) as { status: "running" | "success" } | undefined;
    if (existing) {
      db.exec("COMMIT");
      return { kind: existing.status === "success" ? "reused" : "in_progress" };
    }
    const runId = randomUUID();
    db.prepare(
      `INSERT INTO agent_runs
        (id, project_id, brief_revision_id, source_version_id, adapter_kind, status, started_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?)`,
    ).run(runId, projectId, briefRevisionId, sourceVersionId, adapterKind, new Date().toISOString());
    db.exec("COMMIT");
    return { kind: "claimed", runId };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function agentInput(brief: BriefRow, version: SourceVersionRow): AgentJudgmentInput {
  return {
    radarBriefRevision: brief,
    sourceVersion: {
      id: version.id,
      title: version.title,
      body: version.body,
      originUrl: version.origin_url,
      publishedAt: version.published_at,
      acquiredAt: version.acquired_at,
    },
  };
}

function persistMatch(
  runId: string,
  projectId: string,
  briefRevisionId: string,
  sourceVersionId: string,
  judgment: Extract<AgentJudgment, { match: true }>,
): void {
  const db = database();
  const now = new Date().toISOString();
  const signalId = digest(`${projectId}\u0000${briefRevisionId}\u0000${sourceVersionId}`);
  const itemId = digest(`${projectId}\u0000${judgment.judgmentKey}`);
  const revisionId = digest(`${itemId}\u00001`);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO signals
        (id, project_id, brief_revision_id, source_version_id, evidence_quote, evidence_locator, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, brief_revision_id, source_version_id) DO NOTHING`,
    ).run(signalId, projectId, briefRevisionId, sourceVersionId, judgment.evidence.quote, judgment.evidence.locator, now);
    db.prepare(
      `INSERT INTO intelligence_items (id, project_id, judgment_key, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(project_id, judgment_key) DO NOTHING`,
    ).run(itemId, projectId, judgment.judgmentKey, now);

    const existingRevision = db.prepare(
      `SELECT title, judgment, rationale FROM intelligence_item_revisions
       WHERE intelligence_item_id = ? AND revision_number = 1`,
    ).get(itemId) as { title: string; judgment: string; rationale: string } | undefined;
    if (existingRevision && (
      existingRevision.title !== judgment.title ||
      existingRevision.judgment !== judgment.judgment ||
      existingRevision.rationale !== judgment.rationale
    )) {
      throw new Error("Agent 对同一 judgmentKey 返回了不同判断；当前切片不会静默创建后续修订。");
    }
    if (!existingRevision) {
      db.prepare(
        `INSERT INTO intelligence_item_revisions
          (id, intelligence_item_id, revision_number, title, judgment, rationale, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?)`,
      ).run(revisionId, itemId, judgment.title, judgment.judgment, judgment.rationale, now);
    }
    db.prepare(
      `INSERT INTO intelligence_item_signals (intelligence_item_id, signal_id)
       VALUES (?, ?) ON CONFLICT(intelligence_item_id, signal_id) DO NOTHING`,
    ).run(itemId, signalId);
    db.prepare(
      `UPDATE agent_runs SET status = 'success', outcome = 'matched', reason = ?,
        signal_id = ?, intelligence_item_id = ?, completed_at = ? WHERE id = ?`,
    ).run(judgment.rationale, signalId, itemId, now, runId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function completeNoMatch(runId: string, reason: string): void {
  database().prepare(
    `UPDATE agent_runs SET status = 'success', outcome = 'no_match', reason = ?, completed_at = ?
     WHERE id = ?`,
  ).run(reason, new Date().toISOString(), runId);
}

function failRun(runId: string, error: string): void {
  database().prepare(
    `UPDATE agent_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
  ).run(error, new Date().toISOString(), runId);
}

function mapRun(row: RunRow): JudgmentRunView {
  return {
    id: row.id,
    status: row.status,
    outcome: row.outcome,
    reason: row.reason,
    error: row.error,
    sourceVersionId: row.source_version_id,
    sourceTitle: row.source_title,
    sourceVersionNumber: row.source_version_number,
    briefRevisionId: row.brief_revision_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function groupItems(rows: ItemRow[]): IntelligenceItemView[] {
  const items = new Map<string, IntelligenceItemView>();
  for (const row of rows) {
    let item = items.get(row.id);
    if (!item) {
      item = {
        id: row.id,
        title: row.title,
        judgment: row.judgment,
        rationale: row.rationale,
        revisionNumber: row.revision_number,
        createdAt: row.created_at,
        evidence: [],
      };
      items.set(row.id, item);
    }
    item.evidence.push({
      signalId: row.signal_id,
      briefRevisionId: row.brief_revision_id,
      sourceVersionId: row.source_version_id,
      sourceVersionNumber: row.source_version_number,
      sourceTitle: row.source_title,
      sourceBody: row.source_body,
      sourceOriginUrl: row.source_origin_url,
      evidenceQuote: row.evidence_quote,
      evidenceLocator: row.evidence_locator,
    });
  }
  return [...items.values()];
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
