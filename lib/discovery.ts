import { RadarDomainError } from "./domain-error.js";
import { matchRsshubRoutes, refreshRulesIfStale } from "./rsshub.js";
import { BlockedAddressError, assertAllowedAddress, safeFetch } from "./safe-fetch.js";

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
 * 决定。验收要拿一个本机起的假站点当被粘的网址，所以留一个口子，但它只放行
 * 点名的那几个主机名：整条防护在验收里照样是活的，别的地址一样挡。
 */
function privateOriginAllowed(url: URL): boolean {
  const allowed = (process.env.RADAR_ALLOW_PRIVATE_DISCOVERY ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return allowed.includes(url.hostname);
}

export async function discoverCandidates(pastedUrl: string): Promise<Candidate[]> {
  const url = parsed(pastedUrl);
  // 私网地址在读页面之前就挡掉。等到 `pageFeeds` 里再挡不行——那里的失败会
  // 被当成「这一步没找着」吞掉，然后接着往下走，用户看到的是「够不着」而不是
  // 「这个地址我不会去请求」。
  if (!privateOriginAllowed(url)) await assertAllowedAddress(url.toString());

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
      allowPrivateOrigin: privateOriginAllowed(url),
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

  const declared: Candidate[] = [];
  for (const tag of body.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(?:rss|atom)\+xml/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const title = /title\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    declared.push({
      name: title?.trim() || url.hostname,
      feedUrl: new URL(href, finalUrl).toString(),
      via: "page-feed",
    });
  }
  return withoutBlockedAddresses(declared);
}

/**
 * 页面声明的订阅地址是那个页面写的，不是用户写的——它可以指着 `169.254.169.254`。
 * 挑中之后这条候选会变成一条端点，而端点采集对第一跳是放行私网的，所以拦在
 * 这里：不合规的候选根本不出现在待挑列表里。
 */
async function withoutBlockedAddresses(candidates: Candidate[]): Promise<Candidate[]> {
  const verdicts = await Promise.all(
    candidates.map((candidate) => {
      const feedUrl = new URL(candidate.feedUrl);
      if (privateOriginAllowed(feedUrl)) return true;
      // 只丢「这个地址不该请求」的。解析不出来不算——DNS 一时不通不该让一条
      // 正经候选从列表里消失。
      return assertAllowedAddress(candidate.feedUrl).then(
        () => true,
        (error: unknown) => !(error instanceof BlockedAddressError),
      );
    }),
  );
  return candidates.filter((_, index) => verdicts[index]);
}

/**
 * 认得该域名的渠道适配器。目前只有 GitHub：每个仓库自己就出 Atom，不需要
 * 经过任何中间层。
 */
function adapterCandidates(url: URL): Candidate[] {
  if (!/^(?:www\.)?github\.com$/.test(url.hostname)) return [];
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
}
