"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { ProjectSource } from "@/lib/sources";

type Notice = { kind: "success" | "error"; message: string } | null;

export function SourceNetwork({ projectId, sources }: { projectId: string; sources: ProjectSource[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const url = new FormData(form).get("url");
    setPending("add");
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const result = (await response.json()) as { error?: string; name?: string };
      if (!response.ok) throw new Error(result.error ?? "来源没有保存。");
      form.reset();
      setNotice({ kind: "success", message: `${result.name} 已验证并加入 Source Network。` });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "来源没有保存。" });
    } finally {
      setPending(null);
    }
  }

  async function operate(source: ProjectSource, action: "collect" | "stop") {
    setPending(`${action}:${source.id}`);
    setNotice(null);
    try {
      const suffix = action === "collect" ? "/collect" : "";
      const response = await fetch(`/api/projects/${projectId}/sources/${source.id}${suffix}`, {
        method: action === "collect" ? "POST" : "DELETE",
      });
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "操作没有完成。");
      setNotice({ kind: "success", message: result.message ?? "操作已完成。" });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "操作没有完成。" });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="source-network" aria-labelledby="source-network-title">
      <div className="source-network-heading">
        <div>
          <h2 id="source-network-title">Source Network</h2>
          <p>验证一个公开 Feed，再由你决定何时取得新版本。来源事实属于本地实例。</p>
        </div>
        <form className="source-form" onSubmit={addSource}>
          <label>
            <span>公开 RSS/Atom URL</span>
            <input name="url" type="url" required placeholder="https://example.com/feed.xml" />
          </label>
          <button className="button button-primary" type="submit" disabled={pending === "add"}>
            {pending === "add" ? "正在验证…" : "验证并保存"}
          </button>
        </form>
      </div>

      <p className={`network-notice ${notice?.kind === "error" ? "network-notice-error" : ""}`} aria-live="polite">
        {notice?.message ?? "添加另一个来源即可替换当前配置；停止使用不会删除已经取得的版本。"}
      </p>

      {sources.length === 0 ? (
        <div className="network-empty">
          <strong>还没有来源</strong>
          <p>保存前会先验证 Feed；无效或不可达的 URL 不会显示为健康来源。</p>
        </div>
      ) : (
        <div className="source-list">
          {sources.map((source) => (
            <article className="source-row" key={source.id}>
              <div className="source-summary">
                <div>
                  <h3>{source.name}</h3>
                  <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
                </div>
                <span className={`source-health ${source.healthStatus === "unhealthy" ? "source-health-error" : ""}`}>
                  {source.active ? (source.healthStatus === "healthy" ? "健康" : "异常") : "已停止"}
                </span>
              </div>

              <dl className="source-facts">
                <div><dt>最近尝试</dt><dd>{formatDateTime(source.lastAttemptAt)}</dd></div>
                <div><dt>最近成功</dt><dd>{formatDateTime(source.lastSuccessAt)}</dd></div>
                <div><dt>历史</dt><dd>{source.versions.length} 个不可变版本</dd></div>
              </dl>

              <p className={`source-result ${source.healthStatus === "unhealthy" ? "source-result-error" : ""}`}>
                {source.latestRunMessage}
              </p>

              {source.versions.length > 0 && (
                <ol className="version-list">
                  {source.versions.map((version) => (
                    <li key={version.id}>
                      <span className="version-number">版本 {version.number}</span>
                      <a href={version.originUrl} target="_blank" rel="noreferrer">{version.title}</a>
                      <time dateTime={version.acquiredAt}>{formatShortDate(version.acquiredAt)}</time>
                    </li>
                  ))}
                </ol>
              )}

              <div className="source-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={!source.active || pending === `collect:${source.id}`}
                  onClick={() => operate(source, "collect")}
                >
                  {pending === `collect:${source.id}` ? "正在采集…" : `采集 ${source.name}`}
                </button>
                {source.active && (
                  <button
                    className="text-action"
                    type="button"
                    disabled={pending === `stop:${source.id}`}
                    onClick={() => operate(source, "stop")}
                  >
                    {`停止使用 ${source.name}`}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "尚未成功";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
