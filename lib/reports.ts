import { randomUUID } from "node:crypto";
import {
  configuredRadarAgent,
  type AgentReportGeneration,
  type RadarAgent,
  type ReportGenerationInput,
} from "@/lib/agent";
import { database } from "@/lib/database";
import { getIntelligenceWorkspace, type IntelligenceItemView } from "@/lib/intelligence";
import {
  completeHtmlMaterialPackageIntent,
  createHtmlMaterialPackageIntentInTransaction,
  type HtmlMaterialPackageIntent,
} from "@/lib/material-packages";
import { processInstanceId } from "@/lib/process-instance";

export type ManualReportInput = {
  purpose: string;
  audience: string;
  angle: string;
  intelligenceItemRevisionIds: string[];
};

export type ReportGenerationResult = { reportId: string };

export type ReportRunView = {
  id: string;
  retriedFromRunId: string | null;
  status: "running" | "success" | "failed";
  error: string | null;
  purpose: string;
  audience: string;
  angle: string;
  sourceCutoffAt: string;
  selectedRevisions: ReportRunSelectedRevisionView[];
  reportId: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type ReportEvidenceView = {
  signalId: string;
  evidenceQuote: string;
  intelligenceItemRevisionId: string;
  intelligenceTitle: string;
  intelligenceRevisionNumber: number;
  sourceVersionId: string;
  sourceVersionNumber: number;
  sourceTitle: string;
};

export type ReportClaimView = {
  id: string;
  text: string;
  epistemicRole: "evidence" | "inference" | "user_viewpoint";
  position: number;
  intelligenceItemRevisionId: string;
  intelligenceTitle: string;
  intelligenceRevisionNumber: number;
  evidence: ReportEvidenceView[];
};

export type ReportSelectedRevisionView = {
  id: string;
  title: string;
  revisionNumber: number;
};

export type ReportRunSelectedRevisionView = ReportSelectedRevisionView & {
  signals: Array<{
    id: string;
    evidenceQuote: string;
    sourceVersionId: string;
    sourceVersionNumber: number;
  }>;
};

export type ReportView = {
  id: string;
  revisionId: string;
  title: string;
  revisionNumber: number;
  purpose: string;
  audience: string;
  angle: string;
  sourceCutoffAt: string;
  triggerMethod: "manual";
  generationContext: { adapterKind: string; contractVersion: number };
  createdAt: string;
  selectedRevisions: ReportSelectedRevisionView[];
  claims: ReportClaimView[];
};

export type ReportWorkspace = {
  reports: ReportView[];
  runs: ReportRunView[];
};

type ReportInputSnapshot = ReportGenerationInput;

type RunRow = {
  id: string;
  retried_from_run_id: string | null;
  status: ReportRunView["status"];
  error: string | null;
  input_snapshot_json: string;
  report_id: string | null;
  started_at: string;
  completed_at: string | null;
};

type ReportRow = {
  report_id: string;
  report_revision_id: string;
  title: string;
  revision_number: number;
  purpose: string;
  audience: string;
  angle: string;
  source_cutoff_at: string;
  trigger_method: "manual";
  generation_context_json: string;
  created_at: string;
  claim_id: string;
  claim_position: number;
  claim_text: string;
  epistemic_role: ReportClaimView["epistemicRole"];
  intelligence_item_revision_id: string;
  intelligence_title: string;
  intelligence_revision_number: number;
  signal_id: string;
  evidence_quote: string;
  source_version_id: string;
  source_version_number: number;
  source_title: string;
};

type ReportSelectedRevisionRow = {
  report_id: string;
  intelligence_item_revision_id: string;
  title: string;
  revision_number: number;
};

export async function generateManualReport(
  projectId: string,
  input: ManualReportInput,
  agent: RadarAgent = configuredRadarAgent(),
): Promise<ReportGenerationResult> {
  const normalized = normalizeManualInput(input);
  const items = getIntelligenceWorkspace(projectId).items;
  const selected = selectRevisions(items, normalized.intelligenceItemRevisionIds);
  const snapshot = reportInputSnapshot(projectId, normalized, selected);
  return executeGeneration(projectId, snapshot, agent, null);
}

export async function retryReportGeneration(
  projectId: string,
  runId: string,
  agent: RadarAgent = configuredRadarAgent(),
): Promise<ReportGenerationResult> {
  const row = database().prepare(
    `SELECT status, input_snapshot_json FROM report_generation_runs
     WHERE id = ? AND project_id = ?`,
  ).get(runId, projectId) as { status: string; input_snapshot_json: string } | undefined;
  if (!row) throw new Error("找不到这次 Report 生成运行。");
  if (row.status !== "failed") throw new Error("只有失败的 Report 生成运行可以重试。");
  return executeGeneration(projectId, parseSnapshot(row.input_snapshot_json), agent, runId);
}

export function getReportWorkspace(projectId: string): ReportWorkspace {
  recoverInterruptedRuns(projectId);
  const db = database();
  const runs = db.prepare(
    `SELECT id, retried_from_run_id, status, error, input_snapshot_json, report_id, started_at, completed_at
     FROM report_generation_runs WHERE project_id = ? ORDER BY started_at DESC, id DESC`,
  ).all(projectId) as RunRow[];
  const rows = db.prepare(
    `SELECT report.id AS report_id, revision.id AS report_revision_id,
      revision.title, revision.revision_number, revision.purpose, revision.audience,
      revision.angle, revision.source_cutoff_at, revision.trigger_method,
      revision.generation_context_json, revision.created_at,
      claim.id AS claim_id, claim.position AS claim_position, claim.text AS claim_text,
      claim.epistemic_role,
      intelligence_revision.id AS intelligence_item_revision_id,
      intelligence_revision.title AS intelligence_title,
      intelligence_revision.revision_number AS intelligence_revision_number,
      signal.id AS signal_id, signal.evidence_quote, signal.source_version_id,
      version.version_number AS source_version_number, version.title AS source_title
     FROM reports AS report
     JOIN report_revisions AS revision ON revision.report_id = report.id
     JOIN report_claims AS claim ON claim.report_revision_id = revision.id
     JOIN intelligence_item_revisions AS intelligence_revision
       ON intelligence_revision.id = claim.intelligence_item_revision_id
     JOIN report_claim_signals AS claim_signal ON claim_signal.report_claim_id = claim.id
     JOIN signals AS signal ON signal.id = claim_signal.signal_id
     JOIN source_versions AS version ON version.id = signal.source_version_id
     WHERE report.project_id = ? AND revision.revision_number = 1
     ORDER BY report.created_at DESC, report.id DESC, claim.position, signal.created_at, signal.id`,
  ).all(projectId) as ReportRow[];
  const selectedRows = db.prepare(
    `SELECT report.id AS report_id,
      intelligence_revision.id AS intelligence_item_revision_id,
      intelligence_revision.title, intelligence_revision.revision_number
     FROM reports AS report
     JOIN report_revisions AS revision ON revision.report_id = report.id
     JOIN report_revision_intelligence AS selected
       ON selected.report_revision_id = revision.id
     JOIN intelligence_item_revisions AS intelligence_revision
       ON intelligence_revision.id = selected.intelligence_item_revision_id
     WHERE report.project_id = ? AND revision.revision_number = 1
     ORDER BY report.created_at DESC, report.id DESC, intelligence_revision.created_at, intelligence_revision.id`,
  ).all(projectId) as ReportSelectedRevisionRow[];
  return {
    reports: groupReports(rows, selectedRows),
    runs: runs.map((run) => mapRun(run)),
  };
}

async function executeGeneration(
  projectId: string,
  snapshot: ReportInputSnapshot,
  agent: RadarAgent,
  retriedFromRunId: string | null,
): Promise<ReportGenerationResult> {
  const db = database();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO report_generation_runs
      (id, project_id, retried_from_run_id, adapter_kind, process_instance_id,
       trigger_method, status, source_cutoff_at, input_snapshot_json, started_at)
     VALUES (?, ?, ?, ?, ?, 'manual', 'running', ?, ?, ?)`,
  ).run(
    runId,
    projectId,
    retriedFromRunId,
    agent.kind,
    processInstanceId,
    snapshot.sourceCutoffAt,
    JSON.stringify(snapshot),
    startedAt,
  );

  try {
    const generated = await agent.generateReport(snapshot);
    const report = persistReport(runId, projectId, snapshot, generated, agent.kind);
    try {
      await completeHtmlMaterialPackageIntent(report.materialPackageIntent);
    } catch {
      // The package run records its own failure and never changes a successful Report.
    }
    return { reportId: report.reportId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report 生成失败，可以重试。";
    db.prepare(
      `UPDATE report_generation_runs
       SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
    ).run(message, new Date().toISOString(), runId);
    throw new Error(message);
  }
}

function persistReport(
  runId: string,
  projectId: string,
  snapshot: ReportInputSnapshot,
  generated: AgentReportGeneration,
  adapterKind: string,
): ReportGenerationResult & {
  revisionId: string;
  materialPackageIntent: HtmlMaterialPackageIntent;
} {
  const db = database();
  const reportId = randomUUID();
  const revisionId = randomUUID();
  const now = new Date().toISOString();
  const generationContext = {
    adapterKind,
    contractVersion: 1,
    intelligenceItemRevisionIds: snapshot.intelligenceRevisions.map((revision) => revision.id),
    signalIds: snapshot.intelligenceRevisions.flatMap((revision) => revision.signals.map((signal) => signal.id)),
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO reports (id, project_id, generation_run_id, created_at) VALUES (?, ?, ?, ?)",
    ).run(reportId, projectId, runId, now);
    db.prepare(
      `INSERT INTO report_revisions
        (id, report_id, revision_number, title, purpose, audience, angle,
         source_cutoff_at, trigger_method, generation_context_json, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    ).run(
      revisionId,
      reportId,
      generated.title,
      snapshot.purpose,
      snapshot.audience,
      snapshot.angle,
      snapshot.sourceCutoffAt,
      JSON.stringify(generationContext),
      now,
    );
    const linkRevision = db.prepare(
      `INSERT INTO report_revision_intelligence
        (report_revision_id, intelligence_item_revision_id) VALUES (?, ?)`,
    );
    for (const revision of snapshot.intelligenceRevisions) linkRevision.run(revisionId, revision.id);
    const insertClaim = db.prepare(
      `INSERT INTO report_claims
        (id, report_revision_id, position, text, epistemic_role, intelligence_item_revision_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const linkSignal = db.prepare(
      "INSERT INTO report_claim_signals (report_claim_id, signal_id) VALUES (?, ?)",
    );
    generated.claims.forEach((claim, position) => {
      const claimId = randomUUID();
      insertClaim.run(
        claimId,
        revisionId,
        position,
        claim.text,
        claim.epistemicRole,
        claim.intelligenceItemRevisionId,
      );
      for (const signalId of claim.signalIds) linkSignal.run(claimId, signalId);
    });
    db.prepare(
      `UPDATE report_generation_runs
       SET status = 'success', report_id = ?, completed_at = ? WHERE id = ?`,
    ).run(reportId, now, runId);
    const materialPackageIntent = createHtmlMaterialPackageIntentInTransaction(db, projectId, revisionId);
    db.exec("COMMIT");
    return { reportId, revisionId, materialPackageIntent };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function normalizeManualInput(input: ManualReportInput): ManualReportInput {
  const purpose = boundedText(input.purpose, "内容目的", 200);
  const audience = boundedText(input.audience, "目标受众", 200);
  const angle = boundedText(input.angle, "核心角度", 500);
  const intelligenceItemRevisionIds = [...new Set(input.intelligenceItemRevisionIds)];
  if (intelligenceItemRevisionIds.length === 0) throw new Error("请至少选择一个情报条目。");
  return { purpose, audience, angle, intelligenceItemRevisionIds };
}

function boundedText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`请填写${label}。`);
  if (normalized.length > maximum) throw new Error(`${label}不能超过 ${maximum} 个字符。`);
  return normalized;
}

function selectRevisions(items: IntelligenceItemView[], ids: string[]): IntelligenceItemView[] {
  const byId = new Map(items.map((item) => [item.revisionId, item]));
  const selected = ids.map((id) => byId.get(id));
  if (selected.some((item) => !item)) throw new Error("选中的情报条目修订不属于这个 Project。");
  return selected as IntelligenceItemView[];
}

function reportInputSnapshot(
  projectId: string,
  input: ManualReportInput,
  items: IntelligenceItemView[],
): ReportInputSnapshot {
  return {
    projectId,
    purpose: input.purpose,
    audience: input.audience,
    angle: input.angle,
    sourceCutoffAt: new Date().toISOString(),
    triggerMethod: "manual",
    intelligenceRevisions: items.map((item) => ({
      id: item.revisionId,
      intelligenceItemId: item.id,
      revisionNumber: item.revisionNumber,
      title: item.title,
      judgment: item.judgment,
      rationale: item.rationale,
      signals: item.evidence.map((evidence) => ({
        id: evidence.signalId,
        evidenceQuote: evidence.evidenceQuote,
        sourceVersionId: evidence.sourceVersionId,
        sourceVersionNumber: evidence.sourceVersionNumber,
      })),
    })),
  };
}

function recoverInterruptedRuns(projectId: string): void {
  database().prepare(
    `UPDATE report_generation_runs
     SET status = 'failed', error = ?, completed_at = ?
     WHERE project_id = ? AND status = 'running' AND process_instance_id <> ?`,
  ).run(
    "Radar 在 Report Agent 返回前停止；可以按原输入快照重试。",
    new Date().toISOString(),
    projectId,
    processInstanceId,
  );
}

function mapRun(row: RunRow): ReportRunView {
  const snapshot = parseSnapshot(row.input_snapshot_json);
  return {
    id: row.id,
    retriedFromRunId: row.retried_from_run_id,
    status: row.status,
    error: row.error,
    purpose: snapshot.purpose,
    audience: snapshot.audience,
    angle: snapshot.angle,
    sourceCutoffAt: snapshot.sourceCutoffAt,
    selectedRevisions: snapshot.intelligenceRevisions.map((revision) => ({
      id: revision.id,
      title: revision.title,
      revisionNumber: revision.revisionNumber,
      signals: revision.signals,
    })),
    reportId: row.report_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function groupReports(
  rows: ReportRow[],
  selectedRows: ReportSelectedRevisionRow[],
): ReportView[] {
  const selectedByReport = new Map<string, ReportSelectedRevisionView[]>();
  for (const row of selectedRows) {
    const selected = selectedByReport.get(row.report_id) ?? [];
    selected.push({
      id: row.intelligence_item_revision_id,
      title: row.title,
      revisionNumber: row.revision_number,
    });
    selectedByReport.set(row.report_id, selected);
  }
  const reports = new Map<string, ReportView>();
  const claims = new Map<string, ReportClaimView>();
  for (const row of rows) {
    let report = reports.get(row.report_id);
    if (!report) {
      const context = JSON.parse(row.generation_context_json) as {
        adapterKind: string;
        contractVersion: number;
      };
      report = {
        id: row.report_id,
        revisionId: row.report_revision_id,
        title: row.title,
        revisionNumber: row.revision_number,
        purpose: row.purpose,
        audience: row.audience,
        angle: row.angle,
        sourceCutoffAt: row.source_cutoff_at,
        triggerMethod: row.trigger_method,
        generationContext: context,
        createdAt: row.created_at,
        selectedRevisions: selectedByReport.get(row.report_id) ?? [],
        claims: [],
      };
      reports.set(row.report_id, report);
    }
    let claim = claims.get(row.claim_id);
    if (!claim) {
      claim = {
        id: row.claim_id,
        text: row.claim_text,
        epistemicRole: row.epistemic_role,
        position: row.claim_position,
        intelligenceItemRevisionId: row.intelligence_item_revision_id,
        intelligenceTitle: row.intelligence_title,
        intelligenceRevisionNumber: row.intelligence_revision_number,
        evidence: [],
      };
      claims.set(row.claim_id, claim);
      report.claims.push(claim);
    }
    claim.evidence.push({
      signalId: row.signal_id,
      evidenceQuote: row.evidence_quote,
      intelligenceItemRevisionId: row.intelligence_item_revision_id,
      intelligenceTitle: row.intelligence_title,
      intelligenceRevisionNumber: row.intelligence_revision_number,
      sourceVersionId: row.source_version_id,
      sourceVersionNumber: row.source_version_number,
      sourceTitle: row.source_title,
    });
  }
  return [...reports.values()];
}

function parseSnapshot(value: string): ReportInputSnapshot {
  return JSON.parse(value) as ReportInputSnapshot;
}
