import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/** `hono/html` 模板的返回类型。数组插值时它逐个转义，不需要自己拼字符串。 */
type Html = HtmlEscapedString | Promise<HtmlEscapedString>;
import { isEnabled, type Endpoint } from "../lib/endpoints.js";

/**
 * Web 上只有这一张页，它就是首页（ADR 0013）。一眼看清这台 Radar 现在够得着
 * 什么、什么坏了、什么在等推送。**看归网页，改归对话**——页面上只有实例级
 * 停用一个动作，Brief 级排除不上页面（那是 Brief 级的事，搬上来就要引入
 * Brief 选择器，一张清单立刻变成一个控制台）。
 *
 * `hono/html` 的插值默认转义——feed 标题、端点名与错误原因都由第三方控制，
 * 直接拼进模板字符串就是存储型 XSS。
 */
export function renderHomePage(input: {
  version: string;
  dataDirectory: string;
  endpoints: Endpoint[];
}): Html {
  return html`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Radar · 本地信号聚合站</title>
    <link rel="stylesheet" href="/assets/styles.css" />
  </head>
  <body>
    <main id="main-content" class="page">
      <h1>Radar</h1>
      <p class="lede">这台 Radar 正在本机运行，版本 ${input.version}。</p>
      <p class="meta">本地数据目录：<code>${input.dataDirectory}</code></p>
      <p class="meta">改动请跟你的 Agent 说，或者 <code>radar --help</code>。这一页只管看。</p>
      <ul class="sources">
        ${sortForDisplay(input.endpoints).map(renderRow)}
      </ul>
    </main>
  </body>
</html>
`;
}

/**
 * 单一列表，不分区块：按采集渠道的配置状态排序（装好即用 / 配置后解锁 /
 * 够不着），同一档里按渠道、再按端点名排（ADR 0013）。
 */
const configStateOrder = { ready: 0, unlocked_by_config: 1, unreachable: 2 } as const;

function sortForDisplay(endpoints: Endpoint[]): Endpoint[] {
  return [...endpoints].sort(
    (left, right) =>
      configStateOrder[left.channelConfigState] - configStateOrder[right.channelConfigState] ||
      left.channelName.localeCompare(right.channelName) ||
      left.name.localeCompare(right.name),
  );
}

function renderRow(endpoint: Endpoint): Html {
  const unreachable = endpoint.channelConfigState === "unreachable";
  return html`<li class="source${unreachable ? " is-unreachable" : ""}">
        <div class="source-main">
          <span class="source-name">${endpoint.name}</span>
          <span class="source-url">${endpoint.url}</span>
          <p class="source-channel">${endpoint.channelName}</p>
          ${renderNote(endpoint)}
        </div>
        ${renderStatus(endpoint)}
        ${renderAction(endpoint)}
      </li>`;
}

/** 状态徽章。停用与退役是写下的决定，盖过观察到的来源状态——它压根没在采。 */
function renderStatus(endpoint: Endpoint): Html {
  if (endpoint.retiredAt) return html`<span class="status is-off">已退役</span>`;
  if (endpoint.userDisabledAt) return html`<span class="status is-off">已停用</span>`;
  if (endpoint.status === "awaiting_push") return html`<span class="status is-waiting">等推送</span>`;
  if (endpoint.status === "recently_failed") return html`<span class="status is-failing">最近失败</span>`;
  return html`<span class="status">正常</span>`;
}

/**
 * 一行说明。退役端点显示退役理由并留在列表里——它不消失，那是这台 Radar
 * 少了一块覆盖的记录。`配置后解锁` 用「最后收到推送」代替「已配置」标志：
 * 配没配不是 Radar 知道的事，收没收到推送才是。
 */
function renderNote(endpoint: Endpoint): Html | "" {
  if (endpoint.retiredAt) {
    return html`<p class="source-note">已退役：${endpoint.retiredReason ?? "没有写理由。"}</p>`;
  }
  // 停用之后它压根没在采，上一次失败的原因就不该再摆在那儿当现状。
  if (endpoint.userDisabledAt) return html`<p class="source-note">Radar 不再采它。</p>`;
  if (endpoint.channelConfigState === "unreachable") {
    return html`<p class="source-note">这个渠道 Radar 够不着。</p>`;
  }
  if (endpoint.status === "awaiting_push") {
    return html`<p class="source-note">${
      endpoint.lastPushAt ? `最后收到推送：${endpoint.lastPushAt}` : "还没有收到过推送。"
    }</p>`;
  }
  if (endpoint.status === "recently_failed") {
    return html`<p class="source-note is-error">连续失败 ${endpoint.consecutiveFailures} 次：${
      endpoint.lastError ?? "没有留下错误原因。"
    }</p>`;
  }
  return "";
}

/**
 * 只有实例级停用一个动作。`配置后解锁` 行**没有动作按钮**——那个渠道的内容
 * 本来就由用户的 Agent 推来，停用它没有意义；退役也不是页面上能改的。
 */
function renderAction(endpoint: Endpoint): Html | "" {
  if (endpoint.retiredAt || endpoint.channelConfigState !== "ready") return "";
  const enabled = isEnabled(endpoint);
  return html`<form class="source-action" method="post" action="/sources/${endpoint.id}/enabled">
          <input type="hidden" name="enabled" value="${enabled ? "false" : "true"}" />
          <button type="submit">${enabled ? "停用" : "恢复采集"}</button>
        </form>`;
}
