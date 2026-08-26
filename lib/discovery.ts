import { RadarDomainError } from "./domain-error.js";
import { matchRsshubRoutes, refreshRulesIfStale } from "./rsshub.js";
import { BlockedAddressError, assertPublicAddress, safeFetch } from "./safe-fetch.js";

/**
 * 粘一个网址进来，Radar 尽力把它变成一条可订阅的采集端点。依次尝试：
 * RSSHub 规则库 → 页面自带的 feed → 认得该域名的渠道适配器 → 明示够不着。
 *
 * **都不中就明说够不着，不降级去抓 HTML。** 抓 HTML 拼出来的东西看着像 feed，
 * 实际上页面改个版就悄悄空了，而用户以为自己还在被覆盖着。
 *
 * 匹配可能给出多条候选（同一个主页往往对应视频、动态、专栏几条路由），由用户
 * 挑；挑中之后它就是一个普通的 RSS/Atom 端点，跟这里的规则彻底脱钩。
 */
export type Candidate = {
  name: string;
  feedUrl: string;
  /** 这条候选是怎么来的，用户挑的时候看得见依据。 */
  via: "rsshub" | "page-feed" | "channel-adapter";
};

export class NothingToSubscribeError extends RadarDomainError {
  constructor(url: string) {
    super(
      `${url} 上没有找到可订阅的 feed。Radar 不会去抓 HTML 拼一个出来——` +
        "那种东西页面改版就会悄悄空掉。要么这个站自己出一份 feed，要么配一台 RSSHub。",
      404,
    );
  }
}

/**
 * 粘进来的网址指着内网就不去请求——那是别人塞给用户的地址，不是他自己的
 * 决定。验收要拿一个本机起的假站点当被粘的网址，只有那时才放行第一跳。
 */
function allowPrivateDiscovery(): boolean {
  return process.env.RADAR_ALLOW_PRIVATE_DISCOVERY === "1";
}

export async function discoverCandidates(pastedUrl: string): Promise<Candidate[]> {
  const url = parsed(pastedUrl);
  if (!allowPrivateDiscovery()) await refuseIfPrivate(url);

  await refreshRulesIfStale();
  const candidates: Candidate[] = matchRsshubRoutes(url.toString()).map((candidate) => ({
    name: candidate.name,
    feedUrl: candidate.feedUrl,
    via: "rsshub" as const,
  }));

  candidates.push(...(await pageFeeds(url)));
  candidates.push(...adapterCandidates(url));

  const deduplicated = new Map(candidates.map((candidate) => [candidate.feedUrl, candidate]));
  if (deduplicated.size === 0) throw new NothingToSubscribeError(url.toString());
  return [...deduplicated.values()];
}

/**
 * 私网地址在读页面之前就挡掉。等到 `pageFeeds` 里再挡不行——那里的失败会被
 * 当成「这一步没找着」吞掉，然后接着往下走，用户看到的是「够不着」而不是
 * 「这个地址我不会去请求」。
 */
async function refuseIfPrivate(url: URL): Promise<void> {
  await assertPublicAddress(url.toString());
}

function parsed(pastedUrl: string): URL {
  try {
    return new URL(pastedUrl);
  } catch {
    throw new RadarDomainError(`${pastedUrl} 不是一个网址。`, 400);
  }
}

/**
 * 页面自带的 feed：`<link rel="alternate" type="application/rss+xml">`。读的是
 * 站点自己声明的订阅地址，不是从正文里猜——那条线在这里就到头了。
 */
async function pageFeeds(url: URL): Promise<Candidate[]> {
  let body: string;
  let finalUrl: string;
  try {
    const response = await safeFetch(url.toString(), {
      accept: "text/html,application/xhtml+xml",
      allowPrivateOrigin: allowPrivateDiscovery(),
    });
    // 粘进来的本身就是一份 feed 时，它自己就是唯一那条候选。
    if (/(?:rss|atom)\+xml|text\/xml|application\/xml/i.test(response.contentType)) {
      return [{ name: url.hostname, feedUrl: response.url, via: "page-feed" }];
    }
    body = response.body;
    finalUrl = response.url;
  } catch (error) {
    // 「不去请求那个地址」是一句结论，不是「这一步没找着」——吞掉它，用户会
    // 以为只是够不着，然后换个写法再试一次。
    if (error instanceof BlockedAddressError) throw error;
    // 页面读不到就往下走，不让这一步的失败替整件事下结论。
    return [];
  }

  const candidates: Candidate[] = [];
  for (const tag of body.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(?:rss|atom)\+xml/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const title = /title\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    candidates.push({
      name: title?.trim() || url.hostname,
      feedUrl: new URL(href, finalUrl).toString(),
      via: "page-feed",
    });
  }
  return candidates;
}

/**
 * 认得该域名的渠道适配器。目前只有一条：GitHub 每个仓库自己就出 Atom，
 * 不需要经过任何中间层。新增适配器就在这张表里加一行。
 */
const adapters: Array<{ host: RegExp; build(url: URL): Candidate[] }> = [
  {
    host: /^(?:www\.)?github\.com$/,
    build(url) {
      const [owner, repo] = url.pathname.split("/").filter(Boolean);
      if (!owner || !repo) return [];
      return [
        {
          name: `${owner}/${repo} 的 Releases`,
          feedUrl: `https://github.com/${owner}/${repo}/releases.atom`,
          via: "channel-adapter",
        },
        {
          name: `${owner}/${repo} 的 Commits`,
          feedUrl: `https://github.com/${owner}/${repo}/commits.atom`,
          via: "channel-adapter",
        },
      ];
    },
  },
];

function adapterCandidates(url: URL): Candidate[] {
  return adapters.find((adapter) => adapter.host.test(url.hostname))?.build(url) ?? [];
}
