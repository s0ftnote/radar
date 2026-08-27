import { html } from "hono/html";
import type { Brief } from "../lib/briefs.js";
import type { ContentItem } from "../lib/brief-content.js";
import type { Judgment } from "../lib/judgments.js";
import type { Report } from "../lib/reports.js";
import { renderMarkdown } from "./markdown.js";
import { renderPage, type Html } from "./page-shell.js";
import { excerpt, formatDateTime, hostOf } from "./presentation.js";

export function renderReportPage(input: {
  brief: Brief;
  report: Report;
  references: Array<{ judgment: Judgment; document: ContentItem }>;
}): Html {
  return renderPage({
    title: input.report.title,
    navigation: "tasks",
    content: html`<nav class="breadcrumb" aria-label="面包屑">
        <a href="/">任务</a><span>/</span><a href="/tasks/${input.brief.id}">${input.brief.name}</a><span>/</span><span>报告</span>
      </nav>
      <header class="report-heading">
        <h1>${input.report.title}</h1>
        <p>${formatDateTime(input.report.createdAt)} · ${input.report.generatedBy} 生成 · ${input.report.judgmentIds.length} 条判断</p>
      </header>
      <div class="surface-shell report-shell" data-reveal><article class="report-sheet prose surface-core">${renderMarkdown(input.report.body)}</article></div>
      <section class="report-sources">
        <div class="section-heading"><div><h2>引用判断</h2><p>${input.references.length} 条</p></div></div>
        <div class="surface-shell compact-list-shell" data-reveal><div class="compact-document-list surface-core">${input.references.map(({ judgment, document }) => html`<a href="/tasks/${input.brief.id}/documents/${document.sourceContentId}?judgment=${judgment.id}">
          <span>${document.title}<small>${excerpt(judgment.whyForYou, 90)}</small></span><span>${document.author ?? document.endpointName} · ${hostOf(document.originUrl)} · ${formatDateTime(judgment.createdAt)}</span>
        </a>`)}</div></div>
      </section>`,
  });
}
