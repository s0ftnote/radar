import { html } from "hono/html";
import type { Brief } from "../lib/briefs.js";
import type { ContentFacets, ContentItem } from "../lib/brief-content.js";
import type { Endpoint } from "../lib/endpoints.js";
import type { Report } from "../lib/reports.js";
import { renderMarkdown } from "./markdown.js";
import { renderPage, type Html } from "./page-shell.js";
import { contentStateLabel, excerpt, formatDate, formatDateTime, hostOf } from "./presentation.js";

export function renderTaskPage(input: {
  brief: Brief;
  items: ContentItem[];
  facets: ContentFacets;
  queueDepth: number;
  lastJudgedAt: string | null;
  endpoints: Endpoint[];
  reports: Report[];
}): Html {
  return renderPage({
    title: input.brief.name,
    navigation: "tasks",
    content: html`<nav class="breadcrumb" aria-label="面包屑"><a href="/">任务</a><span>/</span><span>${input.brief.name}</span></nav>
      <header class="page-heading task-heading">
        <div>
          <h1>${input.brief.name}</h1>
          <p>${input.queueDepth} 条待判断 · ${input.lastJudgedAt ? `上次判断 ${formatDateTime(input.lastJudgedAt)}` : "还没判断过"}</p>
        </div>
        <button type="button" class="command-action" data-copy="/radar-delivery">
          <code>/radar-delivery</code><span>生成报告</span>
        </button>
      </header>

      <section class="task-overview">
        <div class="surface-shell brief-shell" data-reveal>
          <article class="brief-sheet surface-core">
            <div class="section-heading">
              <div><h2>Brief</h2><p>第 ${input.brief.currentRevision.number} 版</p></div>
              <details class="edit-disclosure"><summary>编辑</summary>${renderEditForm(input.brief)}</details>
            </div>
            <div class="prose brief-copy">${renderMarkdown(input.brief.currentRevision.body)}</div>
          </article>
        </div>

        <div class="surface-shell source-shell" data-reveal>
          <aside class="source-summary surface-core">
            <div class="section-heading"><div><h2>来源</h2><p>${input.endpoints.length} 条已纳入</p></div><a href="/sources">管理</a></div>
            ${input.endpoints.length === 0
              ? html`<p class="quiet-empty">还没有来源。用 <code>/radar-steward</code> 让 Agent 帮你挑选。</p>`
              : html`<ul class="included-sources">${input.endpoints.map((endpoint) => html`<li>
                    <span>${endpoint.name}</span><span>${sourceState(endpoint)}</span>
                  </li>`)}</ul>`}
          </aside>
        </div>
      </section>

      <section class="content-section" id="contents">
        <div class="section-heading content-heading">
          <div><h2>内容</h2><p>文档与判断</p></div>
          <div class="state-totals" aria-label="内容状态">
            <span>推荐 ${input.facets.counts.for_you}</span>
            <span>略过 ${input.facets.counts.filtered}</span>
            <span>待判断 ${input.facets.counts.pending}</span>
          </div>
        </div>
        ${input.items.length === 0 ? renderEmptyContent() : renderDocumentList(input.brief.id, input.items)}
      </section>

      <section class="report-section" id="reports">
        <div class="section-heading">
          <div><h2>报告</h2><p>Agent 生成</p></div>
          <button type="button" class="text-action" data-copy="/radar-delivery">复制 Skill</button>
        </div>
        ${input.reports.length === 0
          ? html`<p class="quiet-empty">还没有报告。完成第一轮判断后，使用 <code>/radar-delivery</code> 生成。</p>`
          : html`<div class="surface-shell report-list-shell" data-reveal><div class="report-list surface-core">${input.reports.map((report) => html`<a href="/reports/${report.id}" class="report-row">
                <span><strong>${report.title}</strong><small>${excerpt(report.body, 90)}</small></span>
                <span>${formatDate(report.createdAt)} · ${report.judgmentIds.length} 条判断</span>
              </a>`)}</div></div>`}
      </section>

      <details class="danger-zone">
        <summary>移除任务</summary>
        <p>任务会从工作台移除；Brief、判断、反馈和报告历史继续保留。</p>
        <form method="post" action="/tasks/${input.brief.id}/delete" data-confirm-remove>
          <button type="submit">从工作台移除</button>
        </form>
      </details>`,
  });
}

function renderEditForm(brief: Brief): Html {
  return html`<form class="edit-form" method="post" action="/tasks/${brief.id}">
    <label><span>任务名称</span><input name="name" required maxlength="80" value="${brief.name}" /></label>
    <label><span>Brief</span><textarea name="body" required rows="14">${brief.currentRevision.body}</textarea></label>
    <label><span>修改依据</span><input name="rationale" required placeholder="为什么修改这条 Brief" /></label>
    <button class="primary-action" type="submit">保存修改</button>
  </form>`;
}

function renderEmptyContent(): Html {
  return html`<div class="surface-shell content-empty-shell" data-reveal><div class="quiet-empty content-empty surface-core">
      <p>来源配置后，内容会出现在这里。</p>
      <button type="button" class="text-action" data-copy="/radar-steward">复制 Skill</button>
    </div></div>`;
}

function renderDocumentList(briefId: string, items: ContentItem[]): Html {
  return html`<div class="surface-shell document-list-shell" data-reveal><div class="document-list surface-core" role="list">
    <div class="document-columns" aria-hidden="true"><span>文档</span><span>作者 / 平台</span><span>时间</span><span>状态</span></div>
    ${items.map((item) => html`<a class="document-row" role="listitem" href="/tasks/${briefId}/documents/${item.sourceContentId}">
      <span class="document-title">${item.title}<small>${excerpt(item.judgment?.whatItIs || item.body, 76)}</small></span>
      <span>${item.author ?? item.endpointName}<small>${hostOf(item.originUrl)}</small></span>
      <span>${formatDate(item.publishedAt ?? item.at)}</span>
      <span><span class="content-state is-${item.state.replace("_", "-")}">${contentStateLabel(item.state)}</span></span>
    </a>`)}
  </div></div>`;
}

function sourceState(endpoint: Endpoint): string {
  if (endpoint.userDisabledAt) return "已停用";
  if (endpoint.status === "recently_failed") return "最近失败";
  if (endpoint.status === "awaiting_push") return "等推送";
  return "正常";
}
