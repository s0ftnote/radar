import { html } from "hono/html";
import type { Brief } from "../lib/briefs.js";
import type { ContentItem } from "../lib/brief-content.js";
import { renderMarkdown } from "./markdown.js";
import { renderPage, type Html } from "./page-shell.js";
import { contentStateLabel, excerpt, formatDateTime, hostOf, safeExternalUrl } from "./presentation.js";

export function renderDocumentPage(brief: Brief, item: ContentItem): Html {
  const externalUrl = safeExternalUrl(item.originUrl);
  return renderPage({
    title: item.title,
    navigation: "tasks",
    content: html`<nav class="breadcrumb" aria-label="面包屑">
        <a href="/">任务</a><span>/</span><a href="/tasks/${brief.id}">${brief.name}</a><span>/</span><span>文档</span>
      </nav>
      <header class="document-heading">
        <div>
          <span class="content-state is-${item.state.replace("_", "-")}">${contentStateLabel(item.state)}</span>
          <h1>${item.title}</h1>
          <p>${item.author ?? item.endpointName} · ${hostOf(item.originUrl)} · ${formatDateTime(item.publishedAt ?? item.at)}</p>
        </div>
        ${externalUrl
          ? html`<a class="original-action" href="${externalUrl}" target="_blank" rel="noreferrer noopener"><span>原文</span>${externalArrow()}</a>`
          : html`<span class="original-action is-disabled">原文地址不可用</span>`}
      </header>

      <div class="surface-shell document-shell" data-reveal><article class="document-sheet surface-core">
        <section class="summary-block">
          <h2>摘要</h2>
          <p>${excerpt(item.judgment?.whatItIs || item.body, 250)}</p>
        </section>

        <section class="tag-block">
          <h2>标签</h2>
          ${item.tags.length > 0
            ? html`<ul class="tag-list">${item.tags.map((tag) => html`<li>${tag}</li>`)}</ul>`
            : html`<p class="quiet-empty">这篇文档还没有标签。</p>`}
        </section>

        ${item.judgment ? renderJudgment(brief.id, item) : html`<section class="pending-judgment">
            <h2>等待判断</h2>
            <p>Agent 完成后，判断会出现在这里。</p>
          </section>`}

        <details class="source-snapshot">
          <summary>正文快照</summary>
          <div class="prose">${renderMarkdown(item.body)}</div>
        </details>
      </article></div>`,
  });
}

function externalArrow(): Html {
  return html`<span class="action-glyph" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none">
    <path d="M5 13 13 5M7 5h6v6" />
  </svg></span>`;
}

function renderJudgment(briefId: string, item: ContentItem): Html {
  const judgment = item.judgment!;
  return html`<section class="judgment-grid">
      ${item.state === "for_you" ? html`<article><h2>证据</h2><div class="prose">${renderMarkdown(judgment.evidence)}</div></article>
          <article><h2>不确定</h2><div class="prose">${renderMarkdown(judgment.uncertainty)}</div></article>` : ""}
      <article class="judgment-reason"><h2>${item.state === "for_you" ? "与你的关系" : "略过原因"}</h2><div class="prose">${renderMarkdown(judgment.whyForYou)}</div></article>
      <footer>
        <span>判断者 ${judgment.judgedBy}</span>
        ${item.feedback.length > 0
          ? html`<span>你说过：${item.feedback.map((feedback) => feedback.note).join("；")}</span>`
          : html`<form class="inline-feedback" method="post" action="/content/feedback">
              <input type="hidden" name="briefId" value="${briefId}" />
              <input type="hidden" name="judgmentId" value="${judgment.id}" />
              <input type="hidden" name="back" value="/tasks/${briefId}/documents/${item.sourceContentId}" />
              <button type="submit" name="disposition" value="useful">有用</button>
              <button type="submit" name="disposition" value="not_useful">没用</button>
            </form>`}
      </footer>
    </section>`;
}
