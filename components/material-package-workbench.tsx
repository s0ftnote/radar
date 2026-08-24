"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MaterialPackageWorkspace } from "@/lib/material-packages";
import type { ReportWorkspace } from "@/lib/reports";

type Notice = { kind: "success" | "error"; message: string } | null;

export function MaterialPackageWorkbench({
  projectId,
  reports,
  workspace,
}: {
  projectId: string;
  reports: ReportWorkspace["reports"];
  workspace: MaterialPackageWorkspace;
}) {
  const router = useRouter();
  const [selectedReportRevisionId, setSelectedReportRevisionId] = useState(
    reports[0]?.revisionId ?? "",
  );
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [previewOverride, setPreviewOverride] = useState<string | null | undefined>(undefined);
  const defaultPreviewId = workspace.packages.find((item) => item.successfulRunId)?.id ?? null;
  const expandedPackageId = previewOverride === undefined ? defaultPreviewId : previewOverride;
  const isBusy = pending !== null;

  async function supplement() {
    if (!selectedReportRevisionId || isBusy) return;
    await requestPackage(
      { reportRevisionId: selectedReportRevisionId },
      "supplement",
      "新的 HTML 物料包已从固定 Report 修订补发。",
    );
  }

  async function retry(runId: string) {
    if (isBusy) return;
    await requestPackage(
      { retryRunId: runId },
      `retry:${runId}`,
      "HTML 物料包已按原固定快照恢复；失败尝试仍然保留。",
    );
  }

  async function requestPackage(
    body: Record<string, unknown>,
    pendingKey: string,
    successMessage: string,
  ) {
    setPending(pendingKey);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/material-packages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "HTML 物料包生成失败，可以重试。");
      setNotice({ kind: "success", message: successMessage });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "HTML 物料包生成失败，可以重试。",
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="material-workbench" aria-labelledby="material-packages-title" aria-busy={isBusy}>
      <div className="material-heading">
        <div>
          <h2 id="material-packages-title">HTML 平台物料包</h2>
          <p>每份包固定一版 Report，把可读 HTML、可重渲染结构、PNG 与完整出处一起带走。</p>
        </div>
        <span>{workspace.packages.length} 份独立物料包</span>
      </div>

      <div className="material-supplement">
        <label>
          <span>选择补发 Report</span>
          <select
            aria-label="选择补发 Report"
            value={selectedReportRevisionId}
            onChange={(event) => setSelectedReportRevisionId(event.target.value)}
            disabled={isBusy || reports.length === 0}
          >
            {reports.map((report) => (
              <option value={report.revisionId} key={report.revisionId}>
                {report.title} · 修订 {report.revisionNumber}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button-secondary"
          type="button"
          disabled={isBusy || !selectedReportRevisionId}
          onClick={supplement}
        >
          {pending === "supplement" ? "正在补发 HTML 包…" : "补发 HTML 包"}
        </button>
        <p>首次 HTML 包已随 Report 自动尝试；这里仅用于恢复或补充，不改变 Report。</p>
      </div>

      <p
        className={`material-notice ${notice?.kind === "error" ? "material-notice-error" : ""}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {notice?.message ?? ""}
      </p>

      {workspace.packages.length === 0 ? (
        <div className="material-empty">
          <strong>还没有 HTML 物料包</strong>
          <p>下一次成功生成 Report 时会自动创建首次 HTML 包尝试。</p>
        </div>
      ) : (
        <div className="material-list">
          {workspace.packages.map((materialPackage) => (
            <article className="material-package-record" id={`material-package-${materialPackage.id}`} key={materialPackage.id}>
              <header>
                <div>
                  <p>HTML 页面 · Report 修订 {materialPackage.reportRevisionNumber}</p>
                  <h3>{materialPackage.reportTitle}</h3>
                </div>
                <time dateTime={materialPackage.createdAt}>{formatDateTime(materialPackage.createdAt)}</time>
              </header>
              <p className="material-identity">物料包身份 · {materialPackage.id}</p>
              <div className="material-package-actions">
                <a href={`#report-${materialPackage.reportId}`}>固定 Report 修订 {materialPackage.reportRevisionNumber}</a>
                {materialPackage.successfulRunId ? (
                  <>
                    <a href={`/api/projects/${projectId}/material-packages/${materialPackage.id}/download`} download>
                      下载完整 ZIP
                    </a>
                    <a
                      href={`/api/projects/${projectId}/material-packages/${materialPackage.id}/files/index.html`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      新窗口打开 HTML
                    </a>
                    <button
                      className="text-action"
                      type="button"
                      onClick={() => setPreviewOverride(
                        expandedPackageId === materialPackage.id ? null : materialPackage.id,
                      )}
                    >
                      {expandedPackageId === materialPackage.id ? "收起预览" : "打开完整预览"}
                    </button>
                  </>
                ) : (
                  <span>等待成功产物</span>
                )}
              </div>
              <dl className="material-contract">
                <div><dt>Editorial</dt><dd>平台标题、目的、受众与有序主张</dd></div>
                <div><dt>Render source</dt><dd>版本化语义块与资产关系</dd></div>
                <div><dt>Derivatives</dt><dd>与内容同源的 PNG 预览</dd></div>
                <div><dt>Provenance</dt><dd>完整引用与机器可读映射</dd></div>
                <div><dt>Capability snapshot</dt><dd>HTML 下载路径与核验状态</dd></div>
              </dl>
              {materialPackage.successfulRunId && expandedPackageId === materialPackage.id ? (
                <div className="material-preview-frame">
                  <iframe
                    title={`${materialPackage.reportTitle}的离线 HTML 预览`}
                    src={`/api/projects/${projectId}/material-packages/${materialPackage.id}/files/index.html`}
                    sandbox="allow-same-origin"
                  />
                </div>
              ) : !materialPackage.successfulRunId ? (
                <p className="material-preview-empty">生成失败时不伪造预览；修复后可以按原快照重试。</p>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <section className="material-runs" aria-labelledby="material-runs-title">
        <div className="subsection-heading">
          <h3 id="material-runs-title">HTML 包生成运行</h3>
          <span>{workspace.runs.length} 次</span>
        </div>
        {workspace.runs.length === 0 ? (
          <p className="history-empty">尚无运行；Report 成功后会自动创建首次尝试。</p>
        ) : (
          <ol>
            {workspace.runs.map((run) => {
              return (
                <li className="material-package-run" key={run.id}>
                  <div>
                    <span className={`run-status run-status-${run.status === "success" ? "matched" : run.status}`}>
                      {runStatus(run.status)}
                    </span>
                    <strong>{run.reportTitle}</strong>
                  </div>
                  <p>固定 Report 修订 {run.reportRevisionNumber} · 运行身份 {run.id}</p>
                  {run.retriedFromRunId && <p>重试自运行 · {run.retriedFromRunId}</p>}
                  {run.error && <p className="material-run-error">{run.error}</p>}
                  {run.status === "failed" && run.resolvedByRunId && (
                    <p className="material-run-resolution">已由运行 {run.resolvedByRunId} 恢复</p>
                  )}
                  {run.canRetry && (
                    <button className="text-action" type="button" disabled={isBusy} onClick={() => retry(run.id)}>
                      {pending === `retry:${run.id}` ? "正在重试 HTML 包…" : "重试 HTML 包"}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </section>
  );
}

function runStatus(status: MaterialPackageWorkspace["runs"][number]["status"]): string {
  if (status === "running") return "生成中";
  if (status === "failed") return "失败";
  return "已生成";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
