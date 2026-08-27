import { html } from "hono/html";
import type { Brief } from "../lib/briefs.js";
import { renderPage, type Html } from "./page-shell.js";
import { excerpt, formatDateTime } from "./presentation.js";

export type TaskSummary = {
  brief: Brief;
  forYouCount: number;
  pendingCount: number;
  reportCount: number;
  lastJudgedAt: string | null;
};

export function renderTasksPage(tasks: TaskSummary[]): Html {
  return renderPage({
    title: "任务",
    navigation: "tasks",
    content: html`<header class="page-heading with-action">
        <div>
          <h1>任务</h1>
          <p>每条任务都是一份持续生效的 Brief。</p>
        </div>
        <details class="create-disclosure">
          <summary class="primary-action">新建任务</summary>
          ${renderCreateTaskForm()}
        </details>
      </header>

      ${tasks.length === 0
        ? renderEmptyTasks()
        : html`<div class="surface-shell task-list-shell" data-reveal><section class="task-list surface-core" aria-label="任务列表">
            ${tasks.map(renderTaskRow)}
          </section></div>`}`,
  });
}

function renderEmptyTasks(): Html {
  return html`<div class="surface-shell empty-shell" data-reveal><section class="empty-workspace surface-core">
    <div>
      <h2>这里还没有任务</h2>
      <p>直接新建，或让 Agent 帮你配置。</p>
    </div>
    <button type="button" class="command-action" data-copy="/radar-steward">
      <code>/radar-steward</code><span>复制</span>
    </button>
  </section></div>`;
}

function renderTaskRow(task: TaskSummary): Html {
  return html`<article class="task-row">
    <a class="task-main" href="/tasks/${task.brief.id}">
      <span class="task-name">${task.brief.name}</span>
      <span class="task-brief">${excerpt(task.brief.currentRevision.body)}</span>
    </a>
    <dl class="task-facts">
      <div><dt>给你看</dt><dd>${task.forYouCount}</dd></div>
      <div><dt>待判断</dt><dd>${task.pendingCount}</dd></div>
      <div><dt>报告</dt><dd>${task.reportCount}</dd></div>
    </dl>
    <div class="task-updated">
      <span>${task.lastJudgedAt ? `上次判断 ${formatDateTime(task.lastJudgedAt)}` : "还没判断过"}</span>
      <a href="/tasks/${task.brief.id}" aria-label="打开 ${task.brief.name}"><span>打开</span>${smallArrow()}</a>
    </div>
  </article>`;
}

function smallArrow(): Html {
  return html`<span class="action-glyph" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none">
    <path d="M4 9h9m-3.5-3.5L13 9l-3.5 3.5" />
  </svg></span>`;
}

function renderCreateTaskForm(): Html {
  return html`<form class="create-form" method="post" action="/tasks">
    <label>
      <span>任务名称</span>
      <input name="name" required maxlength="80" placeholder="例如：开发者需求雷达" />
    </label>
    <label>
      <span>Brief</span>
      <textarea name="body" required rows="8" placeholder="写清楚什么算数、什么不算数，以及为什么值得持续关注。"></textarea>
    </label>
    <button class="primary-action" type="submit">创建任务</button>
  </form>`;
}
