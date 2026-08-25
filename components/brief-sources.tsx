"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { AvailableInstanceSource, BriefSource } from "@/lib/sources";

type Notice = { kind: "success" | "error"; message: string } | null;

export function BriefSources({
  briefId,
  sources,
  availableSources,
}: {
  briefId: string;
  sources: BriefSource[];
  availableSources: AvailableInstanceSource[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const isBusy = pending !== null;

  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;
    const form = event.currentTarget;
    const url = new FormData(form).get("url");
    setPending("add");
    setNotice(null);
    try {
      const response = await fetch(`/api/briefs/${briefId}/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const result = (await response.json()) as { error?: string; name?: string };
      if (!response.ok) throw new Error(result.error ?? "来源没有保存。");
      form.reset();
      setNotice({ kind: "success", message: `${result.name} 已验证并加入这个 Brief。` });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "来源没有保存。" });
    } finally {
      setPending(null);
    }
  }

  async function operate(source: BriefSource, action: "collect" | "stop") {
    if (isBusy) return;
    setPending(`${action}:${source.id}`);
    setNotice(null);
    try {
      const suffix = action === "collect" ? "/collect" : "";
      const response = await fetch(`/api/briefs/${briefId}/sources/${source.id}${suffix}`, {
        method: action === "collect" ? "POST" : "DELETE",
      });
      const result = (await response.json()) as {
        error?: string;
        message?: string;
        newContentCount?: number;
        reusedContentCount?: number;
      };
      if (!response.ok) throw new Error(result.error ?? "操作没有完成。");
      setNotice({
        kind: "success",
        message: action === "collect"
          ? acquisitionMessage(result.newContentCount ?? 0, result.reusedContentCount ?? 0)
          : (result.message ?? "操作已完成。"),
      });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "操作没有完成。" });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function linkSource(source: { id: string; name: string }) {
    if (isBusy) return;
    setPending(`link:${source.id}`);
    setNotice(null);
    try {
      const response = await fetch(`/api/briefs/${briefId}/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: source.id }),
      });
      const result = (await response.json()) as BriefSource & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "已保存来源没有接入这个 Brief。");
      setNotice({
        kind: "success",
        message: result.contents.length > 0
          ? `已从本地实例复用 ${result.name} 和 ${result.contents.length} 份来源内容；没有重新取得内容。`
          : `${result.name} 已从本地实例接入；无需再次验证，请运行首次采集。`,
      });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "已保存来源没有接入这个 Brief。",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="brief-source-list" aria-labelledby="brief-sources-title" aria-busy={isBusy}>
      <div className="source-heading">
        <div>
          <h2 id="brief-sources-title">来源</h2>
          <p>验证一个公开 Feed，再由你决定何时取得新的来源内容。来源内容属于本地实例。</p>
        </div>
        <form className="source-form" onSubmit={addSource} aria-busy={pending === "add"}>
          <label>
            <span>公开 RSS/Atom URL</span>
            <input name="url" type="url" required placeholder="https://example.com/feed.xml" disabled={isBusy} />
          </label>
          <button className="button button-primary" type="submit" disabled={isBusy}>
            {pending === "add" ? "正在验证…" : "验证并保存"}
          </button>
        </form>
      </div>

      <p className="source-help">可以添加多个来源；停止使用不会删除已经取得的来源内容。</p>
      <p
        className={`source-notice ${notice?.kind === "error" ? "source-notice-error" : ""}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {notice?.message ?? ""}
      </p>

      {availableSources.length > 0 && (
        <section className="available-sources" aria-labelledby="available-sources-title">
          <div>
            <h3 id="available-sources-title">本地实例已有来源</h3>
            <p>已有来源内容会直接复用；尚未采集的来源也无需再次验证。</p>
          </div>
          <div className="available-source-list">
            {availableSources.map((source) => (
              <article className="available-source" key={source.id}>
                <div>
                  <h3>{source.name}</h3>
                  <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
                  <p>{source.contentCount > 0 ? `${source.contentCount} 份已取得来源内容` : "尚未取得来源内容"} · {source.usedByBriefCount} 个 Brief 使用</p>
                </div>
                <span className={`source-health ${source.healthStatus === "unhealthy" ? "source-health-error" : ""}`}>
                  {source.healthStatus === "healthy" ? "健康" : "异常"}
                </span>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={isBusy}
                  onClick={() => linkSource(source)}
                  aria-label={pending === `link:${source.id}`
                    ? `正在接入 ${source.name} ${source.url}`
                    : `使用已保存来源 ${source.name} ${source.url}`}
                >
                  {pending === `link:${source.id}` ? "正在接入…" : "接入这个 Brief"}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {sources.length === 0 ? (
        <div className={`source-empty ${availableSources.length > 0 ? "source-empty-compact" : ""}`}>
          <strong>{availableSources.length > 0 ? "这个 Brief 还没有接入来源" : "还没有来源"}</strong>
          <p>{availableSources.length > 0
            ? "选择上方来源立即复用，或验证一个新的公开 Feed。"
            : "保存前会先验证 Feed；无效或不可达的 URL 不会显示为健康来源。"}</p>
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
                <span className={`source-health ${source.active && source.healthStatus === "unhealthy" ? "source-health-error" : ""} ${!source.active ? "source-health-stopped" : ""}`}>
                  {healthLabel(source)}
                </span>
              </div>

              <dl className="source-facts">
                <div><dt>最近尝试</dt><dd>{formatDateTime(source.lastAttemptAt)}</dd></div>
                <div><dt>最近成功</dt><dd>{formatDateTime(source.lastSuccessAt)}</dd></div>
                <div><dt>共享范围</dt><dd>{source.usedByBriefCount} 个 Brief 使用</dd></div>
                <div><dt>历史</dt><dd>{source.contents.length} 份来源内容</dd></div>
              </dl>

              <p className={`source-result ${source.active && source.healthStatus === "unhealthy" ? "source-result-error" : ""} ${!source.active ? "source-result-stopped" : ""}`}>
                {sourceRunMessage(source)}
              </p>

              {source.contents.length > 0 && (
                <ol className="source-content-list">
                  {source.contents.map((content) => (
                    <li id={`source-content-${content.id}`} key={content.id}>
                      <a href={content.originUrl} target="_blank" rel="noreferrer">{content.title}</a>
                      <time dateTime={content.acquiredAt}>{formatShortDate(content.acquiredAt)}</time>
                    </li>
                  ))}
                </ol>
              )}

              <div className="source-actions">
                {source.active ? (
                  <>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={isBusy}
                      onClick={() => operate(source, "collect")}
                    >
                      {pending === `collect:${source.id}` ? "正在采集…" : `采集 ${source.name}`}
                    </button>
                    <button
                      className="text-action"
                      type="button"
                      disabled={isBusy}
                      onClick={() => operate(source, "stop")}
                    >
                      {`停止使用 ${source.name}`}
                    </button>
                  </>
                ) : (
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={isBusy}
                    onClick={() => linkSource(source)}
                  >
                    {pending === `link:${source.id}` ? "正在重新接入…" : `重新接入 ${source.name}`}
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

function healthLabel(source: BriefSource): string {
  const health = source.healthStatus === "healthy" ? "健康" : "异常";
  return source.active ? health : `已停止 · 最近${health}`;
}

function sourceRunMessage(source: BriefSource): string {
  if (!source.active) return "已停止后续采集，已取得的来源内容保留";
  if (source.latestRun.status === "running") return "正在采集，完成后会在这里显示结果。";
  if (source.latestRun.status === "failed") return source.latestRun.error ?? "采集失败，可以重试。";
  if (source.latestRun.status === "success") {
    return acquisitionMessage(source.latestRun.newContentCount, source.latestRun.reusedContentCount);
  }
  return source.contents.length === 0 ? "已验证，等待首次采集" : `${source.contents.length} 份来源内容`;
}

function acquisitionMessage(created: number, reused: number): string {
  if (created > 0) return `本次新增 ${created} 份来源内容`;
  if (reused > 0) return `未发现内容变化，复用 ${reused} 份来源内容`;
  return "采集成功，Feed 当前没有来源内容";
}
