"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IntelligenceWorkspace, JudgmentBatchResult, JudgmentRunView } from "@/lib/intelligence";

type Notice = { kind: "success" | "error"; message: string } | null;

export function JudgmentWorkbench({
  projectId,
  workspace,
}: {
  projectId: string;
  workspace: IntelligenceWorkspace;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const successfulInputs = new Set(
    workspace.runs
      .filter((run) => run.status === "success")
      .map((run) => `${run.briefRevisionId}:${run.sourceVersionId}`),
  );
  const hasFailure = workspace.runs.some(
    (run) => run.status === "failed" && !successfulInputs.has(`${run.briefRevisionId}:${run.sourceVersionId}`),
  );

  async function runJudgment() {
    if (pending || workspace.sourceVersionCount === 0) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/judgments`, { method: "POST" });
      const result = (await response.json()) as JudgmentBatchResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Radar 判断没有完成，请重试。");
      setNotice(batchNotice(result));
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Radar 判断没有完成，请重试。" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="judgment-workbench" aria-labelledby="judgment-title" aria-busy={pending}>
      <div className="judgment-heading">
        <div>
          <p className="eyebrow">Project intelligence</p>
          <h2 id="judgment-title">Radar 判断</h2>
          <p>用当前 Radar Brief 修订逐一判断来源版本；来源原文与 Project 判断始终分开保存。</p>
        </div>
        <button
          className="button button-primary"
          type="button"
          disabled={pending || workspace.sourceVersionCount === 0}
          onClick={runJudgment}
        >
          {pending ? "正在判断…" : hasFailure ? "重试失败判断" : "运行 Radar 判断"}
        </button>
      </div>

      <p
        className={`judgment-notice ${notice?.kind === "error" ? "judgment-notice-error" : ""}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {notice?.message ?? ""}
      </p>

      {workspace.sourceVersionCount === 0 ? (
        <div className="judgment-empty">
          <strong>还没有可判断的来源版本</strong>
          <p>先在 Source Network 完成一次采集，再让 Agent 根据当前 Brief 作出判断。</p>
        </div>
      ) : (
        <>
          <section className="intelligence-library" aria-labelledby="library-title">
            <div className="subsection-heading">
              <h3 id="library-title">情报库</h3>
              <span>{workspace.items.length} 个判断</span>
            </div>
            {workspace.items.length === 0 ? (
              <div className="library-empty">
                <strong>还没有情报条目</strong>
                <p>有效无匹配不会进入情报库；Agent 失败也不会被保存成负向判断。</p>
              </div>
            ) : (
              <div className="intelligence-items">
                {workspace.items.map((item) => (
                  <article className="intelligence-item" key={item.id}>
                    <header>
                      <div>
                        <p className="eyebrow">情报条目 · 修订 {item.revisionNumber}</p>
                        <h3>{item.title}</h3>
                      </div>
                      <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                    </header>

                    <section className="judgment-copy">
                      <h4>当前判断</h4>
                      <p>{item.judgment}</p>
                      <p className="judgment-rationale">{item.rationale}</p>
                    </section>

                    {item.evidence.map((evidence) => (
                      <section className="evidence-record" key={evidence.signalId}>
                        <div className="evidence-grid">
                          <section>
                            <h4>证据</h4>
                            <blockquote>{evidence.evidenceQuote}</blockquote>
                            <p>{evidence.evidenceLocator}</p>
                          </section>
                          <section>
                            <h4>来源原文</h4>
                            <p>{evidence.sourceBody || "这个来源版本没有正文。"}</p>
                            <a href={evidence.sourceOriginUrl} target="_blank" rel="noreferrer">检查完整出处</a>
                          </section>
                        </div>

                        <dl className="judgment-provenance">
                          <div><dt>Signal</dt><dd>{evidence.signalId}</dd></div>
                          <div><dt>来源版本</dt><dd>{evidence.sourceVersionId} · 版本 {evidence.sourceVersionNumber}</dd></div>
                          <div><dt>Radar Brief 修订</dt><dd>{evidence.briefRevisionId}</dd></div>
                        </dl>
                      </section>
                    ))}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="agent-history" aria-labelledby="agent-history-title">
            <div className="subsection-heading">
              <h3 id="agent-history-title">Agent 运行历史</h3>
              <span>{workspace.runs.length} 次</span>
            </div>
            {workspace.runs.length === 0 ? (
              <p className="history-empty">尚未运行；有效无匹配和失败都会在这里留下不同记录。</p>
            ) : (
              <ol>
                {workspace.runs.map((run) => (
                  <li key={run.id}>
                    <div>
                      <span className={`run-status run-status-${runStatusKind(run)}`}>{runStatusLabel(run)}</span>
                      <strong>{run.sourceTitle} · 版本 {run.sourceVersionNumber}</strong>
                    </div>
                    <p>{run.error ?? run.reason ?? "正在等待 Agent 返回结果。"}</p>
                    <dl>
                      <div><dt>来源版本</dt><dd>{run.sourceVersionId}</dd></div>
                      <div><dt>Radar Brief 修订</dt><dd>{run.briefRevisionId}</dd></div>
                      <div><dt>开始时间</dt><dd>{formatDateTime(run.startedAt)}</dd></div>
                    </dl>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function batchNotice(result: JudgmentBatchResult): Notice {
  if (result.failed > 0) {
    return { kind: "error", message: `${result.failed} 个来源版本 Agent 失败，可以重试；已完成结果保持不变。` };
  }
  if (result.matched > 0) {
    return { kind: "success", message: `${result.matched} 个来源版本形成了可追溯的情报条目。` };
  }
  if (result.noMatch > 0) {
    return { kind: "success", message: `${result.noMatch} 个来源版本有效无匹配；情报库保持不变。` };
  }
  if (result.reused > 0) {
    return { kind: "success", message: `复用 ${result.reused} 个已完成判断，没有重复创建情报条目。` };
  }
  if (result.inProgress > 0) {
    return { kind: "success", message: `${result.inProgress} 个来源版本正在由另一运行处理。` };
  }
  return { kind: "success", message: "没有可判断的来源版本。" };
}

function runStatusKind(run: JudgmentRunView): "running" | "matched" | "empty" | "failed" {
  if (run.status === "running") return "running";
  if (run.status === "failed") return "failed";
  return run.outcome === "matched" ? "matched" : "empty";
}

function runStatusLabel(run: JudgmentRunView): string {
  if (run.status === "running") return "正在判断";
  if (run.status === "failed") return "Agent 调用失败，可以重试";
  return run.outcome === "matched" ? "匹配" : "有效无匹配";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
