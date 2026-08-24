import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";
import sharp from "sharp";
import { radarDataDirectory } from "@/lib/data-directory";
import { database } from "@/lib/database";
import { processInstanceId } from "@/lib/process-instance";

type EpistemicRole = "evidence" | "inference" | "user_viewpoint";

type MaterialPackageSnapshot = {
  schemaVersion: 1;
  packageId: string;
  projectId: string;
  target: "html";
  capturedAt: string;
  report: {
    id: string;
    revisionId: string;
    revisionNumber: number;
    title: string;
    purpose: string;
    audience: string;
    angle: string;
    sourceCutoffAt: string;
    createdAt: string;
  };
  claims: Array<{
    id: string;
    text: string;
    epistemicRole: EpistemicRole;
    intelligenceRevision: { id: string; title: string; revisionNumber: number };
    evidence: Array<{
      signalId: string;
      quote: string;
      sourceVersion: {
        id: string;
        revisionNumber: number;
        title: string;
        originUrl: string;
        publishedAt: string | null;
        acquiredAt: string;
      };
    }>;
  }>;
};

export type MaterialPackageView = {
  id: string;
  reportId: string;
  reportRevisionId: string;
  reportRevisionNumber: number;
  reportTitle: string;
  createdAt: string;
  successfulRunId: string | null;
};

export type MaterialPackageRunView = {
  id: string;
  packageId: string;
  retriedFromRunId: string | null;
  status: "running" | "success" | "failed";
  error: string | null;
  reportTitle: string;
  reportRevisionNumber: number;
  startedAt: string;
  completedAt: string | null;
};

export type MaterialPackageWorkspace = {
  packages: MaterialPackageView[];
  runs: MaterialPackageRunView[];
};

type SnapshotRow = {
  report_id: string;
  report_revision_id: string;
  report_revision_number: number;
  report_title: string;
  purpose: string;
  audience: string;
  angle: string;
  source_cutoff_at: string;
  report_created_at: string;
  claim_id: string;
  claim_text: string;
  epistemic_role: EpistemicRole;
  intelligence_revision_id: string;
  intelligence_title: string;
  intelligence_revision_number: number;
  signal_id: string;
  evidence_quote: string;
  source_version_id: string;
  source_version_number: number;
  source_title: string;
  origin_url: string;
  published_at: string | null;
  acquired_at: string;
};

type PackageRow = {
  id: string;
  report_id: string;
  report_revision_id: string;
  report_revision_number: number;
  report_title: string;
  created_at: string;
  successful_run_id: string | null;
};

type RunRow = {
  id: string;
  material_package_id: string;
  retried_from_run_id: string | null;
  status: MaterialPackageRunView["status"];
  error: string | null;
  report_title: string;
  report_revision_number: number;
  started_at: string;
  completed_at: string | null;
};

const DELIVERED_PATHS = new Set([
  "index.html",
  "assets/styles.css",
  "assets/preview.png",
  "editorial.json",
  "render-source.json",
  "provenance.html",
  "provenance.json",
  "capability-snapshot.json",
  "asset-provenance.json",
  "manifest.json",
]);

export async function createHtmlMaterialPackage(
  projectId: string,
  reportRevisionId: string,
): Promise<{ packageId: string }> {
  const packageId = randomUUID();
  const snapshot = snapshotReport(projectId, reportRevisionId, packageId);
  await executePackageRun(snapshot, null, { projectId, reportRevisionId });
  return { packageId };
}

export async function retryHtmlMaterialPackage(
  projectId: string,
  runId: string,
): Promise<{ packageId: string }> {
  const db = database();
  const row = db.prepare(
    `SELECT run.status, run.input_snapshot_json, run.material_package_id
     FROM material_package_runs AS run
     JOIN material_packages AS package ON package.id = run.material_package_id
     WHERE run.id = ? AND package.project_id = ?`,
  ).get(runId, projectId) as {
    status: string;
    input_snapshot_json: string;
    material_package_id: string;
  } | undefined;
  if (!row) throw new Error("找不到这次 HTML 物料包生成运行。");
  if (row.status !== "failed") throw new Error("只有失败的 HTML 物料包生成运行可以重试。");
  if (resolvedRunIds(row.material_package_id).has(runId)) {
    throw new Error("这次失败已经由后续运行恢复，无需再次重试。");
  }
  const snapshot = JSON.parse(row.input_snapshot_json) as MaterialPackageSnapshot;
  await executePackageRun(snapshot, runId);
  return { packageId: snapshot.packageId };
}

export function getMaterialPackageWorkspace(projectId: string): MaterialPackageWorkspace {
  recoverInterruptedRuns(projectId);
  const db = database();
  const packages = db.prepare(
    `SELECT package.id, report.id AS report_id, revision.id AS report_revision_id,
      revision.revision_number AS report_revision_number, revision.title AS report_title,
      package.created_at,
      (SELECT run.id FROM material_package_runs AS run
       WHERE run.material_package_id = package.id AND run.status = 'success'
       ORDER BY run.started_at DESC, run.id DESC LIMIT 1) AS successful_run_id
     FROM material_packages AS package
     JOIN report_revisions AS revision ON revision.id = package.report_revision_id
     JOIN reports AS report ON report.id = revision.report_id
     WHERE package.project_id = ? AND package.target = 'html'
     ORDER BY package.created_at DESC, package.id DESC`,
  ).all(projectId) as PackageRow[];
  const runs = db.prepare(
    `SELECT run.id, run.material_package_id, run.retried_from_run_id,
      run.status, run.error, revision.title AS report_title,
      revision.revision_number AS report_revision_number,
      run.started_at, run.completed_at
     FROM material_package_runs AS run
     JOIN material_packages AS package ON package.id = run.material_package_id
     JOIN report_revisions AS revision ON revision.id = package.report_revision_id
     WHERE package.project_id = ?
     ORDER BY run.started_at DESC, run.id DESC`,
  ).all(projectId) as RunRow[];
  return {
    packages: packages.map((row) => ({
      id: row.id,
      reportId: row.report_id,
      reportRevisionId: row.report_revision_id,
      reportRevisionNumber: row.report_revision_number,
      reportTitle: row.report_title,
      createdAt: row.created_at,
      successfulRunId: row.successful_run_id,
    })),
    runs: runs.map((row) => ({
      id: row.id,
      packageId: row.material_package_id,
      retriedFromRunId: row.retried_from_run_id,
      status: row.status,
      error: row.error,
      reportTitle: row.report_title,
      reportRevisionNumber: row.report_revision_number,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    })),
  };
}

export async function readMaterialPackageFile(
  projectId: string,
  packageId: string,
  path: string,
): Promise<{ content: Buffer; mediaType: string }> {
  if (!DELIVERED_PATHS.has(path)) throw new Error("找不到这个 HTML 物料包文件。");
  const directory = successfulArtifactDirectory(projectId, packageId);
  return {
    content: await readFile(safeArtifactPath(directory, path)),
    mediaType: mediaType(path),
  };
}

export async function readMaterialPackageDownload(
  projectId: string,
  packageId: string,
): Promise<Buffer> {
  const directory = successfulArtifactDirectory(projectId, packageId);
  return readFile(safeArtifactPath(directory, "package.zip"));
}

async function executePackageRun(
  snapshot: MaterialPackageSnapshot,
  retriedFromRunId: string | null,
  createPackage?: { projectId: string; reportRevisionId: string },
): Promise<void> {
  const db = database();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (createPackage) {
      db.prepare(
        `INSERT INTO material_packages (id, project_id, report_revision_id, target, created_at)
         VALUES (?, ?, ?, 'html', ?)`,
      ).run(snapshot.packageId, createPackage.projectId, createPackage.reportRevisionId, snapshot.capturedAt);
    }
    db.prepare(
      `INSERT INTO material_package_runs
        (id, material_package_id, retried_from_run_id, process_instance_id,
         status, input_snapshot_json, started_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?)`,
    ).run(runId, snapshot.packageId, retriedFromRunId, processInstanceId, JSON.stringify(snapshot), startedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  try {
    const artifactDirectory = await writePackageArtifacts(snapshot, runId);
    db.prepare(
      `UPDATE material_package_runs
       SET status = 'success', artifact_directory = ?, completed_at = ? WHERE id = ?`,
    ).run(artifactDirectory, new Date().toISOString(), runId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "无法写入 HTML 物料包文件。";
    db.prepare(
      `UPDATE material_package_runs
       SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
    ).run(`HTML 物料包生成失败：${reason}`, new Date().toISOString(), runId);
    throw new Error(`HTML 物料包生成失败：${reason}`);
  }
}

async function writePackageArtifacts(
  snapshot: MaterialPackageSnapshot,
  runId: string,
): Promise<string> {
  const packageRoot = join(radarDataDirectory(), "material-packages");
  let temporaryDirectory: string | null = null;
  try {
    await mkdir(packageRoot, { recursive: true });
    temporaryDirectory = await mkdtemp(join(packageRoot, ".tmp-"));
    const files = await buildPackageFiles(snapshot);
    const manifest = buildManifest(snapshot, files);
    files.set("manifest.json", jsonFile(manifest));

    for (const [path, content] of files) {
      const outputPath = safeArtifactPath(temporaryDirectory, path);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content);
    }
    const archive = zipSync(Object.fromEntries(files) as Zippable, { level: 6 });
    await writeFile(join(temporaryDirectory, "package.zip"), archive);

    const finalDirectory = join(packageRoot, snapshot.packageId, runId);
    await mkdir(dirname(finalDirectory), { recursive: true });
    await rename(temporaryDirectory, finalDirectory);
    temporaryDirectory = null;
    return relative(radarDataDirectory(), finalDirectory);
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function buildPackageFiles(snapshot: MaterialPackageSnapshot): Promise<Map<string, Uint8Array>> {
  const renderSource = buildRenderSource(snapshot);
  const editorial = {
    schemaVersion: 1,
    title: snapshot.report.title,
    purpose: snapshot.report.purpose,
    audience: snapshot.report.audience,
    angle: snapshot.report.angle,
    claims: snapshot.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      epistemicRole: claim.epistemicRole,
    })),
  };
  const provenance = buildProvenance(snapshot);
  const capabilitySnapshot = {
    schemaVersion: 1,
    target: "html",
    publishingPath: "download",
    verifiedAt: snapshot.capturedAt,
    capabilities: [
      { key: "offline_readable", status: "verified", value: true },
      { key: "mobile_responsive", status: "verified", value: true },
      { key: "remote_runtime_assets", status: "verified", value: false },
      { key: "hosting", status: "unknown", value: null },
    ],
  };
  const preview = await renderPreviewPng(snapshot);
  const assetProvenance = {
    schemaVersion: 1,
    assets: [
      {
        path: "assets/preview.png",
        kind: "generated_preview",
        createdBy: "Radar HTML renderer",
        createdAt: snapshot.capturedAt,
        usageStatus: "radar_generated",
        transformation: "render-source v1 → SVG → PNG",
        generationContext: { target: "html", rendererVersion: 1 },
      },
    ],
  };
  return new Map([
    ["index.html", textFile(renderIndexHtml(snapshot))],
    ["assets/styles.css", textFile(packageStyles())],
    ["assets/preview.png", preview],
    ["editorial.json", jsonFile(editorial)],
    ["render-source.json", jsonFile(renderSource)],
    ["provenance.html", textFile(renderProvenanceHtml(snapshot))],
    ["provenance.json", jsonFile(provenance)],
    ["capability-snapshot.json", jsonFile(capabilitySnapshot)],
    ["asset-provenance.json", jsonFile(assetProvenance)],
  ]);
}

function buildManifest(snapshot: MaterialPackageSnapshot, files: Map<string, Uint8Array>) {
  return {
    schemaVersion: 1,
    packageId: snapshot.packageId,
    target: snapshot.target,
    createdAt: snapshot.capturedAt,
    report: {
      id: snapshot.report.id,
      revisionId: snapshot.report.revisionId,
      revisionNumber: snapshot.report.revisionNumber,
    },
    sections: {
      editorial: "editorial.json",
      renderSource: "render-source.json",
      derivatives: ["assets/preview.png"],
      provenance: ["provenance.html", "provenance.json", "asset-provenance.json"],
      capabilitySnapshot: "capability-snapshot.json",
    },
    entrypoint: "index.html",
    files: [...files].map(([path, content]) => ({
      path,
      mediaType: mediaType(path),
      bytes: content.byteLength,
      sha256: sha256(content),
    })),
  };
}

function buildRenderSource(snapshot: MaterialPackageSnapshot) {
  return {
    schemaVersion: 1,
    rendererContract: "radar-semantic-document",
    rendererVersion: 1,
    locale: "zh-CN",
    document: {
      title: snapshot.report.title,
      metadata: [
        { label: "内容目的", value: snapshot.report.purpose },
        { label: "目标受众", value: snapshot.report.audience },
        { label: "核心角度", value: snapshot.report.angle },
        { label: "来源截止点", value: snapshot.report.sourceCutoffAt },
      ],
      blocks: snapshot.claims.map((claim) => ({
        type: "claim",
        id: claim.id,
        epistemicRole: claim.epistemicRole,
        text: claim.text,
        evidenceRefs: claim.evidence.map((evidence) => evidence.signalId),
      })),
    },
    assets: [{ id: "preview", role: "document_preview", path: "assets/preview.png" }],
  };
}

function buildProvenance(snapshot: MaterialPackageSnapshot) {
  return {
    schemaVersion: 1,
    packageId: snapshot.packageId,
    report: snapshot.report,
    claims: snapshot.claims,
  };
}

function renderIndexHtml(snapshot: MaterialPackageSnapshot): string {
  const claims = snapshot.claims.map((claim) => `
    <li class="claim" id="claim-${escapeAttribute(claim.id)}">
      <span class="role">${escapeHtml(roleLabel(claim.epistemicRole))}</span>
      <p>${escapeHtml(claim.text)}</p>
    </li>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self'">
  <title>${escapeHtml(snapshot.report.title)}</title>
  <link rel="stylesheet" href="assets/styles.css">
</head>
<body>
  <main>
    <article>
      <header>
        <div class="document-masthead"><strong>Radar</strong><span>HTML 平台物料包</span></div>
        <h1>${escapeHtml(snapshot.report.title)}</h1>
        <p class="angle">${escapeHtml(snapshot.report.angle)}</p>
        <dl>
          <div><dt>内容目的</dt><dd>${escapeHtml(snapshot.report.purpose)}</dd></div>
          <div><dt>目标受众</dt><dd>${escapeHtml(snapshot.report.audience)}</dd></div>
          <div><dt>来源截止点</dt><dd>${escapeHtml(formatUtc(snapshot.report.sourceCutoffAt))}</dd></div>
        </dl>
      </header>
      <img class="preview" src="assets/preview.png" alt="${escapeAttribute(snapshot.report.title)}的 PNG 预览">
      <section aria-labelledby="claims-title">
        <h2 id="claims-title">可追溯主张</h2>
        <ol class="claims">${claims}</ol>
      </section>
      ${renderReferences(snapshot)}
    </article>
  </main>
  <footer><p>由 Radar 固定快照生成 · 物料包 ${escapeHtml(snapshot.packageId)}</p></footer>
</body>
</html>`;
}

function renderProvenanceHtml(snapshot: MaterialPackageSnapshot): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'"><title>${escapeHtml(snapshot.report.title)} · 完整引用</title><link rel="stylesheet" href="assets/styles.css"></head>
<body><main><article><header><div class="document-masthead"><strong>Radar</strong><span>完整引用</span></div><h1>${escapeHtml(snapshot.report.title)}</h1></header>${renderReferences(snapshot)}</article></main></body></html>`;
}

function renderReferences(snapshot: MaterialPackageSnapshot): string {
  const references = snapshot.claims.flatMap((claim) => claim.evidence.map((evidence) => `
    <li id="signal-${escapeAttribute(evidence.signalId)}">
      <blockquote>${escapeHtml(evidence.quote)}</blockquote>
      <p><strong>${escapeHtml(evidence.sourceVersion.title)}</strong> · 来源版本 ${evidence.sourceVersion.revisionNumber}</p>
      <p><a href="${escapeAttribute(evidence.sourceVersion.originUrl)}">${escapeHtml(evidence.sourceVersion.originUrl)}</a></p>
      <p class="identity">Signal ${escapeHtml(evidence.signalId)} · Report 主张 ${escapeHtml(claim.id)}</p>
    </li>`));
  return `<section class="references" aria-labelledby="references-title"><h2 id="references-title">完整引用</h2><ol>${references.join("")}</ol></section>`;
}

async function renderPreviewPng(snapshot: MaterialPackageSnapshot): Promise<Uint8Array> {
  const claimLines = snapshot.claims.slice(0, 4).flatMap((claim) => wrapText(`${roleLabel(claim.epistemicRole)} · ${claim.text}`, 36));
  const titleLines = wrapText(snapshot.report.title, 24).slice(0, 3);
  const titleSvg = titleLines.map((line, index) => `<text x="92" y="${190 + index * 64}" class="title">${escapeHtml(line)}</text>`).join("");
  const claimStart = 190 + titleLines.length * 64 + 72;
  const claimsSvg = claimLines.slice(0, 8).map((line, index) => `<text x="92" y="${claimStart + index * 48}" class="claim">${escapeHtml(line)}</text>`).join("");
  const svg = `<svg width="1200" height="900" viewBox="0 0 1200 900" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="900" fill="#f6f5f1"/>
    <rect x="56" y="56" width="1088" height="788" rx="18" fill="#ffffff" stroke="#c8cac1"/>
    <text x="92" y="120" class="kicker">RADAR · HTML MATERIAL PACKAGE</text>
    ${titleSvg}
    <line x1="92" x2="1108" y1="${claimStart - 44}" y2="${claimStart - 44}" stroke="#ddded7"/>
    ${claimsSvg}
    <style>.kicker{font:700 22px sans-serif;letter-spacing:2px;fill:#24664a}.title{font:700 46px sans-serif;fill:#1e211e}.claim{font:400 28px sans-serif;fill:#454a44}</style>
  </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

function packageStyles(): string {
  return `:root{color-scheme:light;--paper:#f6f5f1;--surface:#fff;--ink:#1e211e;--muted:#656961;--line:#d8d9d2;--green:#24664a}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);font:16px/1.65 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}main,footer{width:min(860px,calc(100% - 36px));margin:0 auto}article{margin:36px 0;padding:clamp(24px,6vw,64px);background:var(--surface);border:1px solid var(--line);border-radius:16px}.document-masthead{display:flex;justify-content:space-between;gap:20px;padding-bottom:14px;border-bottom:1px solid var(--line);color:var(--muted);font-size:13px}.document-masthead strong{color:var(--green);letter-spacing:.08em}h1{max-width:22ch;margin:28px 0 14px;font-size:clamp(32px,7vw,54px);line-height:1.15;letter-spacing:-.035em}.angle{max-width:62ch;color:var(--muted);font-size:19px}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:30px 0 0;padding-top:18px;border-top:1px solid var(--line)}dt,.identity{color:var(--muted);font-size:13px}dd{margin:4px 0 0}.preview{display:block;width:100%;height:auto;margin:36px 0;border:1px solid var(--line);border-radius:10px}section{margin-top:42px;padding-top:28px;border-top:1px solid var(--line)}h2{font-size:24px}.claims,.references ol{margin:0;padding:0;list-style:none}.claim,.references li{padding:22px 0;border-top:1px solid var(--line)}.claim p{margin:8px 0 0;font-size:19px;font-weight:700}.role{display:inline-block;padding:2px 8px;color:var(--muted);background:var(--paper);border:1px solid var(--line);border-radius:999px;font-size:13px;font-weight:700}blockquote{margin:0;padding-left:16px;color:var(--muted);border-left:2px solid var(--line)}a{color:var(--green);overflow-wrap:anywhere;text-underline-offset:.2em}footer{padding:0 0 36px;color:var(--muted);font-size:13px}@media(max-width:620px){main,footer{width:min(100% - 20px,860px)}article{margin:10px 0;padding:24px 20px;border-radius:10px}dl{grid-template-columns:1fr}.angle{font-size:17px}.claim p{font-size:17px}}`;
}

function snapshotReport(
  projectId: string,
  reportRevisionId: string,
  packageId: string,
): MaterialPackageSnapshot {
  const rows = database().prepare(
    `SELECT report.id AS report_id, revision.id AS report_revision_id,
      revision.revision_number AS report_revision_number, revision.title AS report_title,
      revision.purpose, revision.audience, revision.angle, revision.source_cutoff_at,
      revision.created_at AS report_created_at,
      claim.id AS claim_id, claim.text AS claim_text, claim.epistemic_role,
      intelligence_revision.id AS intelligence_revision_id,
      intelligence_revision.title AS intelligence_title,
      intelligence_revision.revision_number AS intelligence_revision_number,
      signal.id AS signal_id, signal.evidence_quote,
      version.id AS source_version_id, version.version_number AS source_version_number,
      version.title AS source_title, version.origin_url, version.published_at, version.acquired_at
     FROM reports AS report
     JOIN report_revisions AS revision ON revision.report_id = report.id
     JOIN report_claims AS claim ON claim.report_revision_id = revision.id
     JOIN intelligence_item_revisions AS intelligence_revision
       ON intelligence_revision.id = claim.intelligence_item_revision_id
     JOIN report_claim_signals AS claim_signal ON claim_signal.report_claim_id = claim.id
     JOIN signals AS signal ON signal.id = claim_signal.signal_id
     JOIN source_versions AS version ON version.id = signal.source_version_id
     WHERE report.project_id = ? AND revision.id = ?
     ORDER BY claim.position, signal.created_at, signal.id`,
  ).all(projectId, reportRevisionId) as SnapshotRow[];
  if (rows.length === 0) throw new Error("找不到可生成 HTML 物料包的 Report 修订。");
  const first = rows[0];
  const claims = new Map<string, MaterialPackageSnapshot["claims"][number]>();
  for (const row of rows) {
    let claim = claims.get(row.claim_id);
    if (!claim) {
      claim = {
        id: row.claim_id,
        text: row.claim_text,
        epistemicRole: row.epistemic_role,
        intelligenceRevision: {
          id: row.intelligence_revision_id,
          title: row.intelligence_title,
          revisionNumber: row.intelligence_revision_number,
        },
        evidence: [],
      };
      claims.set(row.claim_id, claim);
    }
    claim.evidence.push({
      signalId: row.signal_id,
      quote: row.evidence_quote,
      sourceVersion: {
        id: row.source_version_id,
        revisionNumber: row.source_version_number,
        title: row.source_title,
        originUrl: publicCitationUrl(row.origin_url),
        publishedAt: row.published_at,
        acquiredAt: row.acquired_at,
      },
    });
  }
  return {
    schemaVersion: 1,
    packageId,
    projectId,
    target: "html",
    capturedAt: new Date().toISOString(),
    report: {
      id: first.report_id,
      revisionId: first.report_revision_id,
      revisionNumber: first.report_revision_number,
      title: first.report_title,
      purpose: first.purpose,
      audience: first.audience,
      angle: first.angle,
      sourceCutoffAt: first.source_cutoff_at,
      createdAt: first.report_created_at,
    },
    claims: [...claims.values()],
  };
}

function recoverInterruptedRuns(projectId: string): void {
  database().prepare(
    `UPDATE material_package_runs
     SET status = 'failed', error = ?, completed_at = ?
     WHERE status = 'running' AND process_instance_id <> ?
       AND material_package_id IN (SELECT id FROM material_packages WHERE project_id = ?)`,
  ).run(
    "HTML 物料包生成失败：Radar 在文件写入完成前停止；可以按原固定快照重试。",
    new Date().toISOString(),
    processInstanceId,
    projectId,
  );
}

function resolvedRunIds(packageId: string): Set<string> {
  const rows = database().prepare(
    `SELECT id, retried_from_run_id, status FROM material_package_runs
     WHERE material_package_id = ? ORDER BY started_at DESC, id DESC`,
  ).all(packageId) as Array<{ id: string; retried_from_run_id: string | null; status: string }>;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const resolved = new Set<string>();
  for (const row of rows) {
    if (row.status !== "success") continue;
    let ancestor = row.retried_from_run_id;
    while (ancestor && !resolved.has(ancestor)) {
      resolved.add(ancestor);
      ancestor = byId.get(ancestor)?.retried_from_run_id ?? null;
    }
  }
  return resolved;
}

function successfulArtifactDirectory(projectId: string, packageId: string): string {
  const row = database().prepare(
    `SELECT run.artifact_directory
     FROM material_packages AS package
     JOIN material_package_runs AS run ON run.material_package_id = package.id
     WHERE package.id = ? AND package.project_id = ? AND run.status = 'success'
     ORDER BY run.started_at DESC, run.id DESC LIMIT 1`,
  ).get(packageId, projectId) as { artifact_directory: string | null } | undefined;
  if (!row?.artifact_directory) throw new Error("这个 HTML 物料包还没有可用产物。");
  return safeArtifactPath(radarDataDirectory(), row.artifact_directory);
}

function safeArtifactPath(root: string, path: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, path);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error("HTML 物料包路径超出本地数据目录。");
  }
  return resolvedPath;
}

function mediaType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function jsonFile(value: unknown): Uint8Array {
  return textFile(`${JSON.stringify(value, null, 2)}\n`);
}

function textFile(value: string): Uint8Array {
  return strToU8(value);
}

function roleLabel(role: EpistemicRole): string {
  if (role === "evidence") return "证据";
  if (role === "user_viewpoint") return "用户观点";
  return "推断";
}

function wrapText(value: string, width: number): string[] {
  const characters = [...value];
  const lines: string[] = [];
  for (let index = 0; index < characters.length; index += width) {
    lines.push(characters.slice(index, index + width).join(""));
  }
  return lines.length > 0 ? lines : [""];
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function formatUtc(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function publicCitationUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  url.username = "";
  url.password = "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/(?:^|[_-])(?:access[_-]?token|token|api[_-]?key|key|auth(?:orization)?|credential|password|passwd|secret|signature|sig)(?:$|[_-])/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}
