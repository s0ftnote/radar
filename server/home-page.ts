import { html } from "hono/html";
import type { Candidate } from "../lib/discovery.js";
import { groupBy } from "../lib/group-by.js";
import { isEnabled, isInUse, type Endpoint } from "../lib/endpoints.js";
import { renderPage, type Html } from "./page-shell.js";

/**
 * 来源页（ADR 0013）。一眼看清这台 Radar 现在在采什么、什么坏了、什么在等
 * 推送，以及目录里还摆着什么可以加。**看归网页，改归对话**——页面上的动作只
 * 有两个：实例级停用，和把目录里的一条纳入某条 Brief。纳入之所以上页面，是
 * 因为出厂目录是一份目录不是一份订阅：没被纳入的端点 Radar 压根不采（#104），
 * 一张只能看不能加的目录等于摆着一堆点不动的东西。它要选一条 Brief——纳入
 * 本来就是 Brief 级的决定，选不出来就说明该先去建一条。
 *
 * `hono/html` 的插值默认转义——feed 标题、端点名与错误原因都由第三方控制，
 * 直接拼进模板字符串就是存储型 XSS。
 */
export type DiscoveryPanel = {
  pastedUrl: string;
  /** 页面只说一句结果，细节问 Agent（ADR 0013）。 */
  message?: string;
  candidates?: Candidate[];
};

/** 纳入要选一条 Brief，页面因此得知道有哪些 Brief。 */
export type BriefChoice = { id: string; name: string };

export function renderHomePage(input: {
  version: string;
  dataDirectory: string;
  endpoints: Endpoint[];
  briefs: BriefChoice[];
  rsshubBaseUrl: string | null;
  discovery?: DiscoveryPanel;
}): Html {
  return renderPage({
    title: "来源",
    navigation: "sources",
    content: html`<header class="page-heading">
        <h1>来源</h1>
        <p>管理 Radar 的采集来源。</p>
        <p class="instance-meta">Radar ${input.version} · <code>${input.dataDirectory}</code></p>
      </header>
      ${renderInUse(input.endpoints)}
      ${renderCatalog(input.endpoints, input.briefs)}
      ${renderAddSource(input.discovery)}
      ${renderRsshubSetting(input.rsshubBaseUrl)}`,
  });
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

/**
 * 在采的：被某条 Brief 纳入了的，加上用户自己停用掉的、以及目录退役掉的——
 * 后两种都不在采，但那是有人写下的决定，得看得见、说得清、点得回来（ADR 0014
 * 的退役理由就得有这么个地方摆着）。
 */
function renderInUse(endpoints: Endpoint[]): Html {
  const inUse = sortForDisplay(
    endpoints.filter((endpoint) => isInUse(endpoint) || endpoint.retiredAt !== null),
  );
  return html`<section class="panel" data-reveal>
        <h2 class="panel-title">在采的</h2>
        ${inUse.length === 0
          ? html`<p class="empty">
          还没有来源。先创建 Brief，再从目录中选择。
        </p>`
          : html`<ul class="sources">
          ${inUse.map((endpoint) => renderRow(endpoint, renderAction(endpoint)))}
        </ul>`}
      </section>`;
}

/**
 * 目录里还能加的：登记着、没被任何 Brief 要、Radar 因此不采的那些。按 topics
 * 分组折起来——出厂目录有几十条，摊开就是一堵墙，而挑源本来就是「先想清楚要
 * 哪个领域」（ADR 0018）。退役的不在这里：它加不进来，说「还能加」是假话。
 */
function renderCatalog(endpoints: Endpoint[], briefs: BriefChoice[]): Html {
  const addable = sortForDisplay(
    endpoints.filter((endpoint) => !isInUse(endpoint) && endpoint.retiredAt === null),
  );
  const byTopic = groupBy(
    addable.flatMap((endpoint) =>
      (endpoint.topics.length > 0 ? endpoint.topics : [untagged]).map((topic) => ({
        topic,
        endpoint,
      })),
    ),
    (each) => each.topic,
  );
  return html`<section class="panel" data-reveal>
        <h2 class="panel-title">目录里还能加的</h2>
        <p class="source-note">选择来源并纳入 Brief，Radar 才会开始采集。</p>
        ${addable.length === 0
          ? html`<p class="empty">目录里的都已经在采了。</p>`
          : [...byTopic.entries()]
              .sort(([left], [right]) => topicOrder(left) - topicOrder(right) || left.localeCompare(right))
              .map(
                ([topic, rows]) => html`<details class="topic-group">
          <summary>${topic} <span class="count">${rows.length}</span></summary>
          <ul class="sources is-catalog">
            ${rows.map((row) => renderRow(row.endpoint, renderInclude(row.endpoint, briefs)))}
          </ul>
        </details>`,
              )}
      </section>`;
}

/** 用户自己加的端点没有 topics，Radar 不替它猜（ADR 0018），单独归一组排在最后。 */
const untagged = "没标 topics";

function topicOrder(topic: string): number {
  return topic === untagged ? 1 : 0;
}

/** 一行。两半的行长得一样，差的只是右边那个动作。 */
function renderRow(endpoint: Endpoint, action: Html | ""): Html {
  const unreachable = endpoint.channelConfigState === "unreachable";
  return html`<li class="source${unreachable ? " is-unreachable" : ""}">
        <div class="source-core">
          <div class="source-main">
            <span class="source-name">${endpoint.name}</span>
            <span class="source-url">${endpoint.url}</span>
            <p class="source-channel">${endpoint.channelName}</p>
            ${renderTopics(endpoint)}
            ${renderNote(endpoint)}
          </div>
          ${renderStatus(endpoint)}
          ${action}
        </div>
      </li>`;
}

/**
 * 主题标签。建 Brief 时按需求挑源靠的就是它（ADR 0018），页面上只把它摆出来
 * ——挑哪些进哪条 Brief 是对话里的事。
 */
function renderTopics(endpoint: Endpoint): Html | "" {
  if (endpoint.topics.length === 0) return "";
  return html`<p class="source-topics">${endpoint.topics.map(
    (topic) => html`<span class="topic">${topic}</span>`,
  )}</p>`;
}

/** 状态徽章。停用与退役是写下的决定，盖过观察到的来源状态——它压根没在采。 */
function renderStatus(endpoint: Endpoint): Html {
  if (endpoint.retiredAt) return html`<span class="status is-off">已退役</span>`;
  if (endpoint.userDisabledAt) return html`<span class="status is-off">已停用</span>`;
  if (endpoint.status === "not_included") return html`<span class="status is-waiting">未纳入</span>`;
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
    // 页面上没有按钮可点，那就把「为什么没有」说一句：这一档本来就该由
    // 用户自己的 Agent 采完推来（ADR 0011）。怎么推是 Agent 的事，不抄命令。
    return html`<p class="source-note">${
      endpoint.lastPushAt ? `最后收到推送：${endpoint.lastPushAt}` : "还没有收到过推送。"
    } 这一档由你的 Agent 采完推给 Radar。</p>`;
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

/**
 * 纳入到一条 Brief。必须选一条——纳入是 Brief 级的决定，页面上不替用户挑
 * 「默认那条」。一条 Brief 都没有时这里没有动作可给，只说该先去哪儿。
 */
function renderInclude(endpoint: Endpoint, briefs: BriefChoice[]): Html | "" {
  // 够不着的渠道纳进来也采不到，那颗按钮点了什么都不会发生。
  if (endpoint.channelConfigState === "unreachable") return "";
  if (briefs.length === 0) {
    return html`<span class="source-note">还没有 Brief</span>`;
  }
  return html`<form class="source-include" method="post" action="/sources/${endpoint.id}/include">
          <select name="briefId" aria-label="纳入到哪条 Brief">
            ${briefs.map((brief) => html`<option value="${brief.id}">${brief.name}</option>`)}
          </select>
          <button type="submit">纳入</button>
        </form>`;
}

/**
 * 粘一个网址加源。可能匹配出多条候选（同一个主页往往对应视频、动态、专栏
 * 几条路由），由用户挑；挑中之后它就是一条普通的 RSS/Atom 端点。
 */
function renderAddSource(discovery: DiscoveryPanel | undefined): Html {
  return html`<section class="panel" data-reveal>
        <h2 class="panel-title">粘一个网址加源</h2>
        <form class="paste" method="post" action="/sources/discover">
          <input
            type="url"
            name="url"
            required
            placeholder="https://…"
            value="${discovery?.pastedUrl ?? ""}"
          />
          <button type="submit">找找看</button>
        </form>
        ${discovery?.message ? html`<p class="source-note">${discovery.message}</p>` : ""}
        ${discovery?.candidates?.length
          ? html`<ul class="candidates">${discovery.candidates.map(renderCandidate)}</ul>`
          : ""}
      </section>`;
}

const viaLabels: Record<Candidate["via"], string> = {
  "rsshub": "RSSHub 路由",
  "page-feed": "站点自己声明的",
  "well-known-path": "约定路径上探到的",
  "channel-adapter": "渠道适配器",
};

/**
 * 候选带上「怎么来的」，用户挑的时候看得见依据。差一台 RSSHub 实例的那种
 * 照样列出来，但加不进来——先把地址填在下面那处设置里。
 */
function renderCandidate(candidate: Candidate): Html {
  return html`<li class="candidate">
          <div class="source-core">
            <div class="source-main">
              <span class="source-name">${candidate.name}</span>
              <span class="source-url">${candidate.feedUrl}</span>
              <span class="source-note">${viaLabels[candidate.via]}</span>
            </div>
            ${candidate.needs === "rsshub"
              ? html`<span class="source-note">需要一台 RSSHub 实例</span>`
              : html`<form class="source-action" method="post" action="/sources/add">
              <input type="hidden" name="name" value="${candidate.name}" />
              <input type="hidden" name="url" value="${candidate.feedUrl}" />
              <input type="hidden" name="channelId" value="${candidate.channelId}" />
              <button type="submit">加进来</button>
            </form>`}
          </div>
          </li>`;
}

/** 唯一那处实例级设置。不填就跳过 RSSHub 那一步匹配（ADR 0013）。 */
function renderRsshubSetting(baseUrl: string | null): Html {
  return html`<section class="panel" data-reveal>
        <h2 class="panel-title">你的 RSSHub 地址</h2>
        <p class="source-note">
          没填也照样列出匹配到的路由，只是订阅不了——Radar 不替你找一台公共实例。自己起一台：
          <code>docker run -d --name rsshub -p 1200:1200 diygod/rsshub</code>。规则只在粘网址那一刻
          用一次，加进来的端点跟它没有关系。
        </p>
        <form class="paste" method="post" action="/settings/rsshub">
          <input type="url" name="baseUrl" placeholder="https://rsshub.example" value="${baseUrl ?? ""}" />
          <button type="submit">记下</button>
        </form>
      </section>`;
}
