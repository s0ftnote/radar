import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;
export type NavigationSection = "tasks" | "sources";

export function renderPage(input: {
  title: string;
  navigation: NavigationSection;
  content: Html;
}): Html {
  return html`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f4f5f7" />
    <title>${input.title} · Radar</title>
    <link rel="stylesheet" href="/assets/styles.css" />
    <script src="/assets/app.js" defer></script>
  </head>
  <body>
    <!--
      THESIS: Radar 是一套国际化的信号编辑系统；秩序、对齐和信息密度先于装饰。
      OWN-WORLD: 中性灰白画布、白色精密工作栏、石墨文字、单一深蓝动作色、全无衬线排版。
      STORY: 顶部工作栏保持 Agent 与实时状态可达；内容沿统一列网格从任务进入 Brief、来源、判断与报告。
      FIRST VIEWPORT: 轻量顶部工作栏只占必要高度，标题、主动作和任务核心内容在同一网格内完整建立层级。
      FORM: International Grid × Structured Editorial；用户明确推翻 Soft Structuralism 后的新方向；签名动效是克制的列网格逐层显现。
      FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
    -->
    <div class="app-shell">
      <div class="workbench-shell">
        <aside class="workbench" aria-label="Radar 工作台">
          <a class="brand" href="/" aria-label="Radar 任务首页">Radar</a>
          <nav class="primary-nav" aria-label="主要导航">
            <a class="nav-link${input.navigation === "tasks" ? " is-current" : ""}" href="/">
              <span>任务</span>${arrowIcon()}
            </a>
            <a class="nav-link${input.navigation === "sources" ? " is-current" : ""}" href="/sources">
              <span>来源</span>${arrowIcon()}
            </a>
          </nav>

          <section class="skill-dock" aria-labelledby="skill-dock-title">
            <h2 id="skill-dock-title">交给 Agent</h2>
            ${skillCommand("配置", "/radar-steward")}
            ${skillCommand("生成报告", "/radar-delivery")}
            ${skillCommand("打开", "/open-radar")}
          </section>

          <div class="live-state" aria-live="polite">
            <span class="live-dot" aria-hidden="true"></span>
            <span data-live-label>已同步</span>
          </div>
        </aside>
      </div>
      <main id="main-content" class="workspace">${input.content}</main>
    </div>
    <div class="update-notice" data-update-notice hidden>
      Agent 已更新 Radar。<button type="button" data-refresh>刷新查看</button>
    </div>
    <div class="copy-notice" data-copy-notice role="status" aria-live="polite" hidden></div>
  </body>
</html>`;
}

function arrowIcon(): Html {
  return html`<span class="nav-arrow" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none">
    <path d="M4 9h9m-3.5-3.5L13 9l-3.5 3.5" />
  </svg></span>`;
}

function skillCommand(label: string, command: string): Html {
  return html`<div class="skill-command">
    <span>${label}</span>
    <button type="button" data-copy="${command}" aria-label="复制 ${command}">
      <code>${command}</code><span class="copy-label">复制</span>
    </button>
  </div>`;
}
