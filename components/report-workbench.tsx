"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { IntelligenceItemView } from "@/lib/intelligence";
import type { ReportWorkspace } from "@/lib/reports";

type Notice = { kind: "success" | "error"; message: string } | null;

export function ReportWorkbench({
  projectId,
  availableItems,
  workspace,
}: {
  projectId: string;
  availableItems: IntelligenceItemView[];
  workspace: ReportWorkspace;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [selectedRevisionIds, setSelectedRevisionIds] = useState<Set<string>>(new Set());
  const isBusy = pending !== null;
  const resolvedByRunId = indexResolvedRuns(workspace);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;
    if (selectedRevisionIds.size === 0) {
      setNotice({ kind: "error", message: "请至少选择一个情报条目。" });
      return;
    }
    const data = new FormData(event.currentTarget);
    await requestGeneration({
      purpose: data.get("purpose"),
      audience: data.get("audience"),
      angle: data.get("angle"),
      intelligenceItemRevisionIds: data.getAll("intelligenceItemRevisionIds"),
    }, "generate");
  }

  async function retry(runId: string) {
    if (isBusy) return;
    await requestGeneration({ retryRunId: runId }, `retry:${runId}`);
  }

  async function requestGeneration(body: Record<string, unknown>, pendingKey: string) {
    setPending(pendingKey);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { reportId?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Report 生成失败，可以重试。");
      setNotice({ kind: "success", message: "新的 Report 已按本次输入快照生成；历史结果保持不变。" });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        message: `Report 生成失败：${error instanceof Error ? error.message : "可以按原输入重试。"}`,
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="report-workbench" aria-labelledby="reports-title" aria-busy={isBusy}>
      <div className="report-heading">
        <div>
          <h2 id="reports-title">Reports</h2>
          <p>选择已成立的判断，固定内容目的、受众、角度与来源截止点，再生成可追溯主张。</p>
        </div>
        <span>{workspace.reports.length} 份固定结果</span>
      </div>

      <form className="report-form" onSubmit={generate}>
        <fieldset disabled={isBusy || availableItems.length === 0}>
          <legend>选择情报条目</legend>
          {availableItems.length === 0 ? (
            <p className="report-selection-empty">先运行 Radar 判断并形成情报条目，才能生成 Report。</p>
          ) : (
            <div className="report-selections">
              {availableItems.map((item) => (
                <label key={item.revisionId}>
                  <input
                    type="checkbox"
                    name="intelligenceItemRevisionIds"
                    value={item.revisionId}
                    checked={selectedRevisionIds.has(item.revisionId)}
                    onChange={(event) => {
                      setSelectedRevisionIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(item.revisionId);
                        else next.delete(item.revisionId);
                        return next;
                      });
                    }}
                    aria-label={`选择 ${item.title} 修订 ${item.revisionNumber}`}
                  />
                  <span><strong>{item.title}</strong><small>固定修订 {item.revisionNumber} · {item.evidence.length} 条 Signal 证据</small></span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="report-input-grid">
          <label><span>内容目的</span><input name="purpose" required maxLength={200} disabled={isBusy || availableItems.length === 0} /></label>
          <label><span>目标受众</span><input name="audience" required maxLength={200} disabled={isBusy || availableItems.length === 0} /></label>
          <label className="report-angle"><span>核心角度</span><textarea name="angle" required maxLength={500} rows={3} disabled={isBusy || availableItems.length === 0} /></label>
        </div>
        <button className="button button-primary" type="submit" disabled={isBusy || availableItems.length === 0 || selectedRevisionIds.size === 0}>
          {pending === "generate" ? "正在生成 Report…" : "生成 Report"}
        </button>
      </form>

      <p
        className={`report-notice ${notice?.kind === "error" ? "report-notice-error" : ""}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {notice?.message ?? ""}
      </p>

      <section className="report-library" aria-labelledby="report-library-title">
        <div className="subsection-heading">
          <h3 id="report-library-title">Report 历史</h3>
          <span>每次成功生成都有独立身份</span>
        </div>
        {workspace.reports.length === 0 ? (
          <div className="report-empty"><strong>还没有 Report</strong><p>生成失败会保留输入快照，但不会伪造一份结果。</p></div>
        ) : (
          <div className="report-list">
            {workspace.reports.map((report) => (
              <article className="report-record" id={`report-${report.id}`} key={report.id}>
                <header>
                  <div><p>Report · 修订 {report.revisionNumber}</p><h3>{report.title}</h3></div>
                  <time dateTime={report.createdAt}>{formatDateTime(report.createdAt)}</time>
                </header>
                <p className="report-identity">Report 身份 · {report.id}</p>
                <dl className="report-context">
                  <div><dt>内容目的</dt><dd>{report.purpose}</dd></div>
                  <div><dt>目标受众</dt><dd>{report.audience}</dd></div>
                  <div><dt>核心角度</dt><dd>{report.angle}</dd></div>
                  <div><dt>来源截止点</dt><dd><time dateTime={report.sourceCutoffAt}>{formatDateTime(report.sourceCutoffAt)}</time></dd></div>
                  <div><dt>触发方式</dt><dd>{report.triggerMethod === "manual" ? "手动生成" : report.triggerMethod}</dd></div>
                  <div><dt>生成上下文</dt><dd>{report.generationContext.adapterKind} · 契约 {report.generationContext.contractVersion}</dd></div>
                </dl>
                <section className="report-fixed-input">
                  <h4>固定输入</h4>
                  <ul>
                    {report.selectedRevisions.map((revision) => (
                      <li key={revision.id}>
                        <a href={`#intelligence-revision-${revision.id}`}>
                          {revision.title} · 修订 {revision.revisionNumber}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="report-claims">
                  <h4>可追溯主张</h4>
                  <ol>
                    {report.claims.map((claim) => (
                      <li className="report-claim" key={claim.id}>
                        <div className="report-claim-heading">
                          <span>{epistemicRoleLabel(claim.epistemicRole)}</span>
                          <p>{claim.text}</p>
                        </div>
                        {claim.evidence.map((evidence) => (
                          <div className="report-claim-evidence" key={evidence.signalId}>
                            <blockquote>{evidence.evidenceQuote}</blockquote>
                            <nav aria-label="主张出处">
                              <a href={`#intelligence-revision-${evidence.intelligenceItemRevisionId}`}>情报条目修订 {evidence.intelligenceRevisionNumber}</a>
                              <a href={`#signal-${evidence.signalId}`}>Signal 证据</a>
                              <a href={`#source-version-${evidence.sourceVersionId}`}>来源版本 {evidence.sourceVersionNumber}</a>
                            </nav>
                          </div>
                        ))}
                      </li>
                    ))}
                  </ol>
                </section>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="report-runs" aria-labelledby="report-runs-title">
        <div className="subsection-heading"><h3 id="report-runs-title">生成运行</h3><span>{workspace.runs.length} 次</span></div>
        {workspace.runs.length === 0 ? (
          <p className="history-empty">尚未生成；运行会先保存固定输入，再调用 Agent。</p>
        ) : (
          <ol>
            {workspace.runs.map((run) => {
              const resolvingRun = resolvedByRunId.get(run.id);
              return (
              <li className="report-run" key={run.id}>
                <div>
                  <span className={`run-status run-status-${run.status === "success" ? "matched" : run.status}`}>{runStatus(run.status)}</span>
                  <strong>{run.purpose}</strong>
                </div>
                <p>{run.audience} · {run.angle}</p>
                <div className="report-run-meta">
                  <span>运行身份 · {run.id}</span>
                  <span>开始时间 · {formatDateTime(run.startedAt)}</span>
                  <span>来源截止 · {formatDateTime(run.sourceCutoffAt)}</span>
                  {run.retriedFromRunId && <span>重试自运行 · {run.retriedFromRunId}</span>}
                  {run.reportId && <a href={`#report-${run.reportId}`}>打开对应 Report</a>}
                </div>
                {run.error && <p className="report-run-error">{run.error}</p>}
                <section className="report-run-input" aria-label="固定输入快照">
                  {run.selectedRevisions.map((revision) => (
                    <div key={revision.id}>
                      <a href={`#intelligence-revision-${revision.id}`}>
                        {revision.title} · 修订 {revision.revisionNumber}
                      </a>
                      <nav aria-label={`${revision.title} 的固定 Signal`}>
                        {revision.signals.map((signal, index) => (
                          <a href={`#signal-${signal.id}`} key={signal.id}>固定 Signal {index + 1}</a>
                        ))}
                      </nav>
                    </div>
                  ))}
                </section>
                {run.status === "failed" && resolvingRun && (
                  <p className="report-run-resolution">已由运行 {resolvingRun.id} 恢复</p>
                )}
                {run.status === "failed" && !resolvingRun && (
                  <button className="text-action" type="button" disabled={isBusy} onClick={() => retry(run.id)}>
                    {pending === `retry:${run.id}` ? "正在重试…" : "重试这次生成"}
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

function indexResolvedRuns(workspace: ReportWorkspace): Map<string, ReportWorkspace["runs"][number]> {
  const runsById = new Map(workspace.runs.map((run) => [run.id, run]));
  const resolvedByRunId = new Map<string, ReportWorkspace["runs"][number]>();
  for (const run of workspace.runs) {
    if (run.status !== "success") continue;
    const visited = new Set<string>();
    let ancestorId = run.retriedFromRunId;
    while (ancestorId && !visited.has(ancestorId)) {
      visited.add(ancestorId);
      if (!resolvedByRunId.has(ancestorId)) resolvedByRunId.set(ancestorId, run);
      ancestorId = runsById.get(ancestorId)?.retriedFromRunId ?? null;
    }
  }
  return resolvedByRunId;
}

function epistemicRoleLabel(
  role: "evidence" | "inference" | "user_viewpoint",
): string {
  if (role === "evidence") return "证据";
  if (role === "user_viewpoint") return "用户观点";
  return "推断";
}

function runStatus(status: "running" | "success" | "failed"): string {
  if (status === "running") return "生成中";
  if (status === "failed") return "失败";
  return "已生成";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
