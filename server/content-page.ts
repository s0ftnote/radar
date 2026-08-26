import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Brief } from "../lib/briefs.js";
import type { ContentFacets, ContentItem, ContentState } from "../lib/brief-content.js";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

/**
 * 内容页：这台 Radar 到底给你攒下了什么。来源页答的是「够得着什么」，这一页
 * 答的是「里面有什么」——用户先想看的是后者，所以它是首页（ADR 0017）。
 *
 * 一条流加筛选，不分死区块：三档的边界会随判断不断移动，写成固定区块就要在
 * 页面上反复解释「为什么这条跑到那边去了」。筛选是链接不是脚本，刷新即最新，
 * 也让每一种视图都有自己的网址可以留着。
 *
 * `hono/html` 的插值默认转义——标题、判断正文都由第三方或 Agent 写入。
 */
export type ContentView = {
  briefs: Brief[];
  brief: Brief | null;
  items: ContentItem[];
  facets: ContentFacets;
  queueDepth: number;
  lastJudgedAt: string | null;
  activeStates: ContentState[];
  activeEndpointId: string | null;
  /** 列表截断到这个条数时说一句，不然「就这么多」和「只显示这么多」分不清。 */
  truncatedAt: number | null;
};

const stateLabels: Record<ContentState, string> = {
  for_you: "给你看",
  filtered: "判过没给",
  pending: "还没轮到",
};

export function renderContentPage(view: ContentView): Html {
  return html`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Radar · 你的信号</title>
    <link rel="stylesheet" href="/assets/styles.css" />
  </head>
  <body>
    <main id="main-content" class="page">
      <nav class="tabs">
        <span class="tab is-current">内容</span>
        <a class="tab" href="/sources">来源</a>
      </nav>
      ${view.brief ? renderBrief(view) : renderNoBrief()}
    </main>
  </body>
</html>
`;
}

/** 一条 Brief 都还没有：这一页没什么可看的，去说一句话就有了。 */
function renderNoBrief(): Html {
  return html`<h1>还没有 Brief</h1>
      <p class="lede">Brief 是你写下的那句「我想一直知道什么」。跟你的 Agent 说一句就有了。</p>
      <p class="meta">来源已经在采了，等你说清楚要看什么，它们才知道往哪儿归。</p>`;
}

function renderBrief(view: ContentView): Html {
  const brief = view.brief!;
  return html`<h1>${brief.name}</h1>
      <p class="lede">${brief.currentRevision.body}</p>
      <p class="meta">
        队列还有 ${view.queueDepth} 条待判断 ·
        ${view.lastJudgedAt ? `上次判断 ${view.lastJudgedAt}` : "还没判断过"}
      </p>
      <p class="meta">改动请跟你的 Agent 说。这一页只管看，和说一句「这条有用没用」。</p>
      ${renderBriefSwitcher(view)}
      ${renderFilters(view)}
      ${view.items.length === 0
        ? html`<p class="empty">这一档现在没有内容。</p>`
        : html`<ul class="contents">${view.items.map((item) => renderItem(item, view))}</ul>`}
      ${view.truncatedAt
        ? html`<p class="meta">只显示了最近 ${view.truncatedAt} 条，再往前的问你的 Agent。</p>`
        : ""}`;
}

/** 多个 Brief 才需要切换器——只有一个的时候它是纯噪音。 */
function renderBriefSwitcher(view: ContentView): Html | "" {
  if (view.briefs.length < 2) return "";
  return html`<nav class="briefs">
        ${view.briefs.map(
          (brief) =>
            html`<a
              class="chip${brief.id === view.brief?.id ? " is-on" : ""}"
              href="${linkTo(view, { briefId: brief.id, states: [], endpointId: null })}"
              >${brief.name}</a
            >`,
        )}
      </nav>`;
}

/**
 * 两组筛选：档与来源。档可以多选（勾上的再点一下就取消），来源是单选——
 * 「同时看这两个源」几乎没人要，多选会让链接和数目都变复杂。
 */
function renderFilters(view: ContentView): Html {
  const states: ContentState[] = ["for_you", "filtered", "pending"];
  return html`<div class="filters">
        <div class="filter-row">
          <span class="filter-label">档</span>
          <a
            class="chip${view.activeStates.length === 0 ? " is-on" : ""}"
            href="${linkTo(view, { states: [] })}"
            >全部</a
          >
          ${states.map((state) => {
            const on = view.activeStates.includes(state);
            const next = on
              ? view.activeStates.filter((each) => each !== state)
              : [...view.activeStates, state];
            return html`<a class="chip${on ? " is-on" : ""}" href="${linkTo(view, { states: next })}"
              >${stateLabels[state]} <span class="count">${view.facets.counts[state]}</span></a
            >`;
          })}
        </div>
        <div class="filter-row">
          <span class="filter-label">来源</span>
          <a
            class="chip${view.activeEndpointId === null ? " is-on" : ""}"
            href="${linkTo(view, { endpointId: null })}"
            >全部</a
          >
          ${view.facets.endpoints.map(
            (endpoint) =>
              html`<a
                class="chip${endpoint.id === view.activeEndpointId ? " is-on" : ""}"
                href="${linkTo(view, {
                  endpointId: endpoint.id === view.activeEndpointId ? null : endpoint.id,
                })}"
                >${endpoint.name} <span class="count">${endpoint.count}</span></a
              >`,
          )}
        </div>
      </div>`;
}

function renderItem(item: ContentItem, view: ContentView): Html {
  return html`<li class="content is-${item.state.replace("_", "-")}">
          <div class="content-head">
            <span class="status is-${item.state.replace("_", "-")}">${stateLabels[item.state]}</span>
            <a class="content-title" href="${item.originUrl}" rel="noreferrer noopener" target="_blank"
              >${item.title}</a
            >
          </div>
          <p class="meta">${item.endpointName} · ${item.at}</p>
          ${renderJudgment(item)}
          ${renderFeedback(item, view)}
        </li>`;
}

/**
 * 判过的四问原样摆出来。判不相关时前三块本来就是空的，只有淘汰理由——那就
 * 只显示那一条，不留三行空标签。
 */
function renderJudgment(item: ContentItem): Html | "" {
  const judgment = item.judgment;
  if (!judgment) return "";
  const lines: Array<[string, string]> =
    item.state === "for_you"
      ? [
          ["这是什么", judgment.whatItIs],
          ["凭什么这么说", judgment.evidence],
          ["哪里还不确定", judgment.uncertainty],
          ["为什么给你看", judgment.whyForYou],
        ]
      : [["为什么没给你", judgment.whyForYou]];
  return html`<dl class="quad">
            ${lines.map(([label, value]) => html`<dt>${label}</dt><dd>${value}</dd>`)}
          </dl>
          <p class="meta">判断者 ${judgment.judgedBy}</p>`;
}

/**
 * 「有用 / 没用」两个按钮。反馈的处置标签平时由 Agent 归纳，页面上没有让人
 * 打字的地方，所以这两个按钮固定写死这两个标签——那也正是页面能表达的全部
 * （ADR 0017）。说过的话摆在旁边，不然同一条会被反复点。
 */
function renderFeedback(item: ContentItem, view: ContentView): Html | "" {
  if (!item.judgment) return "";
  if (item.feedback.length > 0) {
    return html`<p class="said">你说过：${item.feedback.map((each) => each.note).join("；")}</p>`;
  }
  return html`<form class="says" method="post" action="/content/feedback">
            <input type="hidden" name="briefId" value="${view.brief!.id}" />
            <input type="hidden" name="judgmentId" value="${item.judgment.id}" />
            <input type="hidden" name="back" value="${linkTo(view, {})}" />
            <button type="submit" name="disposition" value="useful">有用</button>
            <button type="submit" name="disposition" value="not_useful">没用</button>
          </form>`;
}

/** 当前视图换掉其中几项之后的网址。筛选是链接，每一种视图都留得住。 */
function linkTo(
  view: ContentView,
  change: { briefId?: string; states?: ContentState[]; endpointId?: string | null },
): string {
  const briefId = change.briefId ?? view.brief?.id;
  const states = change.states ?? view.activeStates;
  const endpointId = change.endpointId === undefined ? view.activeEndpointId : change.endpointId;

  const query = new URLSearchParams();
  if (briefId) query.set("brief", briefId);
  for (const state of states) query.append("state", state);
  if (endpointId) query.set("endpoint", endpointId);
  const rendered = query.toString();
  return rendered ? `/?${rendered}` : "/";
}
