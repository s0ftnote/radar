import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
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
        publicLocator:
          | { status: "available"; url: string }
          | { status: "withheld"; site: string | null; reason: "unverified_public_locator" };
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
  resolvedByRunId: string | null;
  canRetry: boolean;
};

export type HtmlMaterialPackageIntent = {
  runId: string;
  snapshot: MaterialPackageSnapshot;
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
  public_locator_url: string | null;
  public_locator_status: "available" | "withheld_unverified";
  public_site_url: string | null;
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
  "assets/ZCOOLXiaoWei-Regular.ttf",
  "assets/OFL.txt",
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
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  let intent: HtmlMaterialPackageIntent;
  try {
    intent = createHtmlMaterialPackageIntentInTransaction(db, projectId, reportRevisionId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  await completeHtmlMaterialPackageIntent(intent);
  return { packageId: intent.snapshot.packageId };
}

export function createHtmlMaterialPackageIntentInTransaction(
  db: DatabaseSync,
  projectId: string,
  reportRevisionId: string,
): HtmlMaterialPackageIntent {
  if (!db.isTransaction) {
    throw new Error("HTML 物料包 intent 必须在调用方的数据库事务内登记。");
  }
  const packageId = randomUUID();
  const snapshot = snapshotReport(db, projectId, reportRevisionId, packageId);
  const runId = randomUUID();
  db.prepare(
    `INSERT INTO material_packages (id, project_id, report_revision_id, target, created_at)
     VALUES (?, ?, ?, 'html', ?)`,
  ).run(packageId, projectId, reportRevisionId, snapshot.capturedAt);
  insertPackageRun(db, runId, snapshot, null);
  return { runId, snapshot };
}

export async function completeHtmlMaterialPackageIntent(
  intent: HtmlMaterialPackageIntent,
): Promise<void> {
  await completePackageRun(intent.snapshot, intent.runId);
}

export async function retryHtmlMaterialPackage(
  projectId: string,
  runId: string,
): Promise<{ packageId: string }> {
  cleanupPendingArtifacts(projectId);
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
  const retryRunId = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    insertPackageRun(db, retryRunId, snapshot, runId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  await completePackageRun(snapshot, retryRunId);
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
  const resolvingRuns = indexResolvingRuns(runs);
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
      resolvedByRunId: resolvingRuns.get(row.id) ?? null,
      canRetry: row.status === "failed" && !resolvingRuns.has(row.id),
    })),
  };
}

export function hasUnresolvedMaterialPackageFailure(
  workspace: MaterialPackageWorkspace,
): boolean {
  return workspace.runs.some((run) => run.canRetry);
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

function insertPackageRun(
  db: DatabaseSync,
  runId: string,
  snapshot: MaterialPackageSnapshot,
  retriedFromRunId: string | null,
): void {
  const startedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO material_package_runs
      (id, material_package_id, retried_from_run_id, process_instance_id,
       status, input_snapshot_json, started_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?)`,
  ).run(runId, snapshot.packageId, retriedFromRunId, processInstanceId, JSON.stringify(snapshot), startedAt);
}

async function completePackageRun(snapshot: MaterialPackageSnapshot, runId: string): Promise<void> {
  const db = database();
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
  const stagingDirectory = join(packageRoot, ".staging", runId);
  const finalDirectory = join(packageRoot, snapshot.packageId, runId);
  try {
    await mkdir(packageRoot, { recursive: true });
    await rm(stagingDirectory, { recursive: true, force: true });
    await rm(finalDirectory, { recursive: true, force: true });
    await mkdir(stagingDirectory, { recursive: true });
    const files = await buildPackageFiles(snapshot);
    const manifest = buildManifest(snapshot, files);
    files.set("manifest.json", jsonFile(manifest));

    for (const [path, content] of files) {
      const outputPath = safeArtifactPath(stagingDirectory, path);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content);
    }
    const archive = zipSync(Object.fromEntries(files) as Zippable, { level: 6 });
    await writeFile(join(stagingDirectory, "package.zip"), archive);

    await mkdir(dirname(finalDirectory), { recursive: true });
    await rename(stagingDirectory, finalDirectory);
    return relative(radarDataDirectory(), finalDirectory);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function buildPackageFiles(snapshot: MaterialPackageSnapshot): Promise<Map<string, Uint8Array>> {
  const renderSource = buildRenderSource(snapshot);
  const renderSourceFile = jsonFile(renderSource);
  const renderSourceSha256 = sha256(renderSourceFile);
  const font = new Uint8Array(await readFile(join(process.cwd(), "app/fonts/ZCOOLXiaoWei-Regular.ttf")));
  const fontLicense = new Uint8Array(await readFile(join(process.cwd(), "app/fonts/OFL.txt")));
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
  const preview = await renderPreviewPng(renderSource, font);
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
        generationContext: { target: "html", rendererVersion: 1, renderSourceSha256 },
      },
      {
        path: "assets/ZCOOLXiaoWei-Regular.ttf",
        kind: "bundled_font",
        source: "https://github.com/googlefonts/zcool-xiaowei/",
        createdBy: "The ZCOOL XiaoWei Project Authors",
        originalCreatedYear: 2018,
        acquiredAt: "2026-08-24T11:13:27.000Z",
        bundledAt: snapshot.capturedAt,
        license: "SIL Open Font License 1.1",
        usageStatus: "redistributed_under_ofl",
        transformation: "none",
        generationContext: { license: "assets/OFL.txt" },
      },
    ],
  };
  return new Map([
    ["index.html", textFile(renderIndexHtml(renderSource, snapshot))],
    ["assets/styles.css", textFile(packageStyles())],
    ["assets/preview.png", preview],
    ["assets/ZCOOLXiaoWei-Regular.ttf", font],
    ["assets/OFL.txt", fontLicense],
    ["editorial.json", jsonFile(editorial)],
    ["render-source.json", renderSourceFile],
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
        { key: "purpose", label: "内容目的", value: snapshot.report.purpose },
        { key: "audience", label: "目标受众", value: snapshot.report.audience },
        { key: "angle", label: "核心角度", value: snapshot.report.angle },
        {
          key: "source_cutoff_at",
          label: "来源截止点（UTC）",
          value: snapshot.report.sourceCutoffAt,
          displayValue: formatUtc(snapshot.report.sourceCutoffAt),
        },
      ],
      blocks: snapshot.claims.map((claim) => ({
        type: "claim",
        id: claim.id,
        epistemicRole: claim.epistemicRole,
        text: claim.text,
        evidenceRefs: claim.evidence.map((evidence, index) => ({
          id: referenceId(claim.id, evidence.signalId),
          label: `引用 ${index + 1}：${evidence.sourceVersion.title} · 来源修订 ${evidence.sourceVersion.revisionNumber}`,
        })),
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

type HtmlRenderSource = ReturnType<typeof buildRenderSource>;

function renderIndexHtml(renderSource: HtmlRenderSource, snapshot: MaterialPackageSnapshot): string {
  const claims = renderSource.document.blocks.map((claim) => `
    <li class="claim" id="claim-${escapeAttribute(claim.id)}">
      <span class="role">${escapeHtml(roleLabel(claim.epistemicRole))}</span>
      <p>${escapeHtml(claim.text)}</p>
      <p class="claim-references">${claim.evidenceRefs.map((reference) => `<a href="#${escapeAttribute(reference.id)}">${escapeHtml(reference.label)}</a>`).join(" · ")}</p>
    </li>`).join("");
  const metadata = new Map(renderSource.document.metadata.map((item) => [item.key, item]));
  const purpose = metadata.get("purpose")!;
  const audience = metadata.get("audience")!;
  const angle = metadata.get("angle")!;
  const sourceCutoff = metadata.get("source_cutoff_at")!;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self'; font-src 'self'">
  <title>${escapeHtml(renderSource.document.title)}</title>
  <link rel="stylesheet" href="assets/styles.css">
</head>
<body>
  <main>
    <article>
      <header>
        <div class="document-masthead"><strong>Radar</strong><span>HTML 平台物料包</span></div>
        <h1>${escapeHtml(renderSource.document.title)}</h1>
        <p class="angle">${escapeHtml(angle.value)}</p>
        <dl>
          <div><dt>${escapeHtml(purpose.label)}</dt><dd>${escapeHtml(purpose.value)}</dd></div>
          <div><dt>${escapeHtml(audience.label)}</dt><dd>${escapeHtml(audience.value)}</dd></div>
          <div><dt>${escapeHtml(sourceCutoff.label)}</dt><dd><time datetime="${escapeAttribute(sourceCutoff.value)}">${escapeHtml(sourceCutoff.displayValue ?? sourceCutoff.value)}</time></dd></div>
        </dl>
      </header>
      <section aria-labelledby="claims-title">
        <h2 id="claims-title">可追溯主张</h2>
        <ol class="claims">${claims}</ol>
      </section>
      <figure>
        <img class="preview" src="assets/preview.png" alt="${escapeAttribute(renderSource.document.title)}的 PNG 预览">
        <figcaption>与本文共享同一份 render source 的 PNG 衍生预览</figcaption>
      </figure>
      ${renderReferences(snapshot)}
    </article>
  </main>
  <footer><p>由 Radar 固定快照生成 · 物料包 ${escapeHtml(snapshot.packageId)}</p></footer>
</body>
</html>`;
}

function renderProvenanceHtml(snapshot: MaterialPackageSnapshot): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; font-src 'self'"><title>${escapeHtml(snapshot.report.title)} · 完整引用</title><link rel="stylesheet" href="assets/styles.css"></head>
<body><main><article><header><div class="document-masthead"><strong>Radar</strong><span>完整引用</span></div><h1>${escapeHtml(snapshot.report.title)}</h1></header>${renderReferences(snapshot)}</article></main></body></html>`;
}

function renderReferences(snapshot: MaterialPackageSnapshot): string {
  const references = snapshot.claims.flatMap((claim) => claim.evidence.map((evidence) => `
    <li id="${escapeAttribute(referenceId(claim.id, evidence.signalId))}">
      <blockquote>${escapeHtml(evidence.quote)}</blockquote>
      <p><strong>${escapeHtml(evidence.sourceVersion.title)}</strong> · ${renderPublicLocator(evidence.sourceVersion.publicLocator)}</p>
      <dl class="reference-chain">
        <div><dt>Report 主张</dt><dd>${escapeHtml(claim.id)} · ${escapeHtml(roleLabel(claim.epistemicRole))}</dd></div>
        <div><dt>判断修订</dt><dd>${escapeHtml(claim.intelligenceRevision.title)} · 修订 ${claim.intelligenceRevision.revisionNumber} · ${escapeHtml(claim.intelligenceRevision.id)}</dd></div>
        <div><dt>Signal</dt><dd>${escapeHtml(evidence.signalId)}</dd></div>
        <div><dt>来源版本</dt><dd>修订 ${evidence.sourceVersion.revisionNumber} · ${escapeHtml(evidence.sourceVersion.id)}</dd></div>
        ${evidence.sourceVersion.publishedAt ? `<div><dt>发布时间（UTC）</dt><dd><time datetime="${escapeAttribute(evidence.sourceVersion.publishedAt)}">${escapeHtml(formatUtc(evidence.sourceVersion.publishedAt))}</time></dd></div>` : ""}
        <div><dt>采集时间（UTC）</dt><dd><time datetime="${escapeAttribute(evidence.sourceVersion.acquiredAt)}">${escapeHtml(formatUtc(evidence.sourceVersion.acquiredAt))}</time></dd></div>
      </dl>
    </li>`));
  const hasWithheldLocator = snapshot.claims.some((claim) =>
    claim.evidence.some((evidence) => evidence.sourceVersion.publicLocator.status === "withheld"),
  );
  const locatorNotice = hasWithheldLocator
    ? `<p class="provenance-note">部分引用没有经来源适配器确认的公开 canonical locator。为避免复制来源会话、授权码或私密路径，包内省略其原始定位；请用来源版本身份在本地 Radar 回查精确记录。</p>`
    : "";
  return `<section class="report-identity" aria-labelledby="report-identity-title"><h2 id="report-identity-title">固定身份</h2><dl class="reference-chain"><div><dt>物料包</dt><dd>${escapeHtml(snapshot.packageId)}</dd></div><div><dt>Report</dt><dd>${escapeHtml(snapshot.report.id)}</dd></div><div><dt>Report 修订</dt><dd>修订 ${snapshot.report.revisionNumber} · ${escapeHtml(snapshot.report.revisionId)}</dd></div><div><dt>Report 创建时间（UTC）</dt><dd><time datetime="${escapeAttribute(snapshot.report.createdAt)}">${escapeHtml(formatUtc(snapshot.report.createdAt))}</time></dd></div><div><dt>来源截止点（UTC）</dt><dd><time datetime="${escapeAttribute(snapshot.report.sourceCutoffAt)}">${escapeHtml(formatUtc(snapshot.report.sourceCutoffAt))}</time></dd></div></dl></section><section class="references" aria-labelledby="references-title"><h2 id="references-title">完整引用</h2>${locatorNotice}<ol>${references.join("")}</ol></section>`;
}

async function renderPreviewPng(renderSource: HtmlRenderSource, font: Uint8Array): Promise<Uint8Array> {
  const claimLines = renderSource.document.blocks.flatMap((claim) => wrapText(`${roleLabel(claim.epistemicRole)} · ${claim.text}`, 36));
  const titleLines = wrapText(renderSource.document.title, 24);
  const titleSvg = titleLines.map((line, index) => `<text x="92" y="${190 + index * 64}" class="title">${escapeHtml(line)}</text>`).join("");
  const claimStart = 190 + titleLines.length * 64 + 72;
  const claimsSvg = claimLines.map((line, index) => `<text x="92" y="${claimStart + index * 48}" class="claim">${escapeHtml(line)}</text>`).join("");
  const height = Math.max(900, claimStart + claimLines.length * 48 + 100);
  const embeddedFont = Buffer.from(font).toString("base64");
  const svg = `<svg width="1200" height="${height}" viewBox="0 0 1200 ${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="${height}" fill="#f6f5f1"/>
    <rect x="56" y="56" width="1088" height="${height - 112}" rx="18" fill="#ffffff" stroke="#c8cac1"/>
    <text x="92" y="120" class="brand">Radar</text>
    <text x="1108" y="120" text-anchor="end" class="meta">HTML · PNG PREVIEW</text>
    <line x1="92" x2="1108" y1="146" y2="146" stroke="#ddded7"/>
    ${titleSvg}
    <line x1="92" x2="1108" y1="${claimStart - 44}" y2="${claimStart - 44}" stroke="#ddded7"/>
    ${claimsSvg}
    <style>@font-face{font-family:RadarEditorial;src:url(data:font/ttf;base64,${embeddedFont})}.brand{font:400 24px RadarEditorial,serif;letter-spacing:2px;fill:#1e211e}.meta{font:600 18px sans-serif;letter-spacing:1px;fill:#656961}.title{font:400 46px RadarEditorial,serif;fill:#1e211e}.claim{font:400 28px sans-serif;fill:#454a44}</style>
  </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

function packageStyles(): string {
  return `@font-face{font-family:RadarEditorial;src:url("ZCOOLXiaoWei-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap}:root{color-scheme:light;--paper:#f6f5f1;--surface:#fff;--ink:#1e211e;--muted:#656961;--line:#d8d9d2;--green:#24664a}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);font:15px/1.65 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}main,footer{width:min(860px,calc(100% - 36px));margin:0 auto}article{margin:36px 0;padding:clamp(24px,6vw,64px);background:var(--surface);border:1px solid var(--line);border-radius:14px}.document-masthead{display:flex;justify-content:space-between;gap:20px;padding-bottom:14px;border-bottom:1px solid var(--line);color:var(--muted);font-size:13px}.document-masthead strong{color:var(--ink);font:400 17px RadarEditorial,serif;letter-spacing:.08em}h1{max-width:22ch;margin:28px 0 14px;font:400 38px/1.15 RadarEditorial,serif;letter-spacing:-.035em}.angle{max-width:62ch;color:var(--muted);font-size:17px}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:30px 0 0;padding-top:18px;border-top:1px solid var(--line)}dt,.identity{color:var(--muted);font-size:13px}dd{margin:4px 0 0}.reference-chain{grid-template-columns:1fr 1fr;margin-top:16px}.reference-chain div{min-width:0}.reference-chain dd{overflow-wrap:anywhere}figure{margin:42px 0 0;padding-top:28px;border-top:1px solid var(--line)}.preview{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px}figcaption,.claim-references{margin-top:8px;color:var(--muted);font-size:13px}.provenance-note{max-width:68ch;color:var(--muted)}section{margin-top:42px;padding-top:28px;border-top:1px solid var(--line)}h2{font-size:24px}.claims,.references ol{margin:0;padding:0;list-style:none}.claim,.references li{padding:22px 0;border-top:1px solid var(--line)}.claim p{margin:8px 0 0;font-size:17px;font-weight:700}.claim .claim-references{font-size:13px;font-weight:400}.role{display:inline-block;padding:2px 8px;color:var(--muted);background:var(--paper);border:1px solid var(--line);border-radius:999px;font-size:13px;font-weight:700}blockquote{margin:0;padding-left:16px;color:var(--muted);border-left:1px solid var(--line)}a{color:var(--green);overflow-wrap:anywhere;text-underline-offset:.2em}footer{padding:0 0 36px;color:var(--muted);font-size:13px}@media(max-width:620px){main,footer{width:min(100% - 20px,860px)}article{margin:10px 0;padding:24px 20px;border-radius:10px}dl,.reference-chain{grid-template-columns:1fr}}`;
}

function snapshotReport(
  db: DatabaseSync,
  projectId: string,
  reportRevisionId: string,
  packageId: string,
): MaterialPackageSnapshot {
  const rows = db.prepare(
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
      version.title AS source_title, version.public_locator_url, version.public_locator_status,
      version.public_site_url, version.published_at, version.acquired_at
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
        publicLocator: row.public_locator_status === "available" && row.public_locator_url
          ? { status: "available", url: row.public_locator_url }
          : {
              status: "withheld",
              site: row.public_site_url,
              reason: "unverified_public_locator",
            },
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
  const db = database();
  const rows = db.prepare(
    `SELECT run.id, run.material_package_id
     FROM material_package_runs AS run
     JOIN material_packages AS package ON package.id = run.material_package_id
     WHERE package.project_id = ? AND run.status = 'running' AND run.process_instance_id <> ?`,
  ).all(projectId, processInstanceId) as Array<{ id: string; material_package_id: string }>;
  const packageRoot = join(radarDataDirectory(), "material-packages");
  const failRun = db.prepare(
    `UPDATE material_package_runs
     SET status = 'failed', cleanup_pending = 1, error = ?, completed_at = ? WHERE id = ?`,
  );
  const interruptedError = "HTML 物料包生成失败：Radar 在文件写入完成前停止；可以按原固定快照重试。";
  const failedAt = new Date().toISOString();
  for (const row of rows) {
    failRun.run(interruptedError, failedAt, row.id);
  }
  cleanupPendingArtifacts(projectId);
}

function cleanupPendingArtifacts(projectId: string): void {
  const db = database();
  const rows = db.prepare(
    `SELECT run.id, run.material_package_id
     FROM material_package_runs AS run
     JOIN material_packages AS package ON package.id = run.material_package_id
     WHERE package.project_id = ? AND run.cleanup_pending = 1`,
  ).all(projectId) as Array<{ id: string; material_package_id: string }>;
  const packageRoot = join(radarDataDirectory(), "material-packages");
  const markClean = db.prepare(
    `UPDATE material_package_runs
     SET cleanup_pending = 0,
       error = CASE WHEN instr(error, '清理未完成') > 0 THEN error || ' 旧文件现已清理。' ELSE error END
     WHERE id = ?`,
  );
  const recordCleanupFailure = db.prepare(
    `UPDATE material_package_runs
     SET error = CASE WHEN instr(error, '清理未完成') = 0 THEN error || ? ELSE error END
     WHERE id = ?`,
  );
  for (const row of rows) {
    const failures: string[] = [];
    for (const [label, path] of [
      ["staging", join(".staging", row.id)],
      ["final", join(row.material_package_id, row.id)],
    ] as const) {
      try {
        rmSync(safeArtifactPath(packageRoot, path), { recursive: true, force: true });
      } catch {
        failures.push(label);
      }
    }
    if (failures.length > 0) {
      recordCleanupFailure.run(` 清理未完成（${failures.join("、")}）；恢复写权限后刷新或重试会再次清理。`, row.id);
    } else {
      markClean.run(row.id);
    }
  }
}

function resolvedRunIds(packageId: string): Set<string> {
  const rows = database().prepare(
    `SELECT id, retried_from_run_id, status FROM material_package_runs
     WHERE material_package_id = ? ORDER BY started_at DESC, id DESC`,
  ).all(packageId) as Array<{ id: string; retried_from_run_id: string | null; status: string }>;
  return new Set(indexResolvingRuns(rows).keys());
}

function indexResolvingRuns(
  rows: Array<{ id: string; retried_from_run_id: string | null; status: string }>,
): Map<string, string> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const resolving = new Map<string, string>();
  for (const row of rows) {
    if (row.status !== "success") continue;
    const visited = new Set<string>();
    let ancestor = row.retried_from_run_id;
    while (ancestor && !visited.has(ancestor)) {
      visited.add(ancestor);
      if (!resolving.has(ancestor)) resolving.set(ancestor, row.id);
      ancestor = byId.get(ancestor)?.retried_from_run_id ?? null;
    }
  }
  return resolving;
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
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".ttf")) return "font/ttf";
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

function referenceId(claimId: string, signalId: string): string {
  return `reference-${claimId}-${signalId}`;
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
  return `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function renderPublicLocator(locator: MaterialPackageSnapshot["claims"][number]["evidence"][number]["sourceVersion"]["publicLocator"]): string {
  if (locator.status === "available") {
    return `<a href="${escapeAttribute(locator.url)}">原始来源 ${escapeHtml(locator.url)}</a>`;
  }
  const site = locator.site ? ` · 来源站点（非原文定位）${escapeHtml(locator.site)}` : "";
  return `<span class="withheld-locator">原始定位已省略${site}</span>`;
}
