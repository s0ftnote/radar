import { RadarDomainError } from "./domain-error.js";
import { fetchFeed } from "./feed.js";
import { matchRsshubRoutes, refreshRulesIfStale } from "./rsshub.js";
import { BlockedAddressError, assertAllowedAddress, safeFetch } from "./safe-fetch.js";

/**
 * 粘一个网址进来，Radar 尽力把它变成一条可订阅的采集端点。依次尝试：
 * RSSHub 规则库 → 页面自带的 feed → 约定路径 → 认得该域名的渠道适配器 →
 * 明示够不着。
 *
 * **都不中就明说够不着，不降级去抓 HTML。** 抓 HTML 拼出来的东西看着像 feed，
 * 实际上页面改个版就悄悄空了，而用户以为自己还在被覆盖着。约定路径不算抓
 * HTML：探到的地址要能被 `lib/feed.ts` 解析成 RSS/Atom 才算数，站点自己出的
 * 一份 feed 就是一份 feed。
 *
 * 匹配可能给出多条候选（同一个主页往往对应视频、动态、专栏几条路由），由用户
 * 挑；挑中之后它就是一个普通的 RSS/Atom 端点，跟这里的规则彻底脱钩。
 */
export type Candidate = {
  name: string;
  feedUrl: string;
  /** 这条候选是怎么来的，用户挑的时候看得见依据。 */
  via: "rsshub" | "page-feed" | "well-known-path" | "channel-adapter";
  /**
   * 挑中之后登记到哪个采集渠道下。绝大多数是 `rss`；Reddit 这种要登录态的
   * 归 `agent-push`，由用户自己的 Agent 采完推给 Radar（ADR 0011）。
   */
  channelId: "rss" | "agent-push";
  /**
   * 还差一样东西才能用。目前只有一种：RSSHub 规则匹上了路由，但用户还没有
   * 一台自己的 RSSHub 实例——这时 `feedUrl` 是那条路由本身，还不是一个能
   * 订阅的地址。Radar 照样把它列出来，好让用户知道自己差的是什么，但不替
   * 他找一台公共实例（ADR 0013）。
   */
  needs?: "rsshub";
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
  // 私网地址在读页面之前就挡掉。等到 `readPage` 里再挡不行——那里的失败会
  // 被当成「这一步没找着」吞掉，然后接着往下走，用户看到的是「够不着」而不是
  // 「这个地址我不会去请求」。
  if (!privateOriginAllowed(url)) await assertAllowedAddress(url.toString());

  await refreshRulesIfStale();
  const candidates: Candidate[] = matchRsshubRoutes(url.toString()).map((candidate) => ({
    name: candidate.name,
    // 没有实例时给的是路由本身。它还不是一个地址，但用户看得见「规则认得这个
    // 网址，我差的只是一台 RSSHub」，这比一句「够不着」有用。
    feedUrl: candidate.feedUrl ?? candidate.route,
    via: "rsshub" as const,
    channelId: "rss" as const,
    ...(candidate.feedUrl === null ? { needs: "rsshub" as const } : {}),
  }));

  // 页面只读一次：页面自带的 feed 与 YouTube 这类要从页面取 id 的适配器，
  // 读的是同一份 HTML。
  const page = await readPage(url);
  const declared = page ? await pageFeeds(page, url) : [];
  candidates.push(...declared);
  // 站点自己声明了订阅地址就以它为准，不再去挨个敲门。
  if (declared.length === 0) candidates.push(...(await wellKnownPathFeeds(url)));
  candidates.push(...channelAdapterCandidates(url, page?.body ?? null));

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

type Page = { body: string; url: string; isFeed: boolean };

async function readPage(url: URL): Promise<Page | null> {
  try {
    const response = await safeFetch(url.toString(), {
      accept: "text/html,application/xhtml+xml",
      allowPrivateOrigin: privateOriginAllowed(url),
    });
    return {
      body: response.body,
      url: response.url,
      isFeed: /(?:rss|atom)\+xml|text\/xml|application\/xml/i.test(response.contentType),
    };
  } catch (error) {
    // 「不去请求那个地址」是一句结论，不是「这一步没找着」——吞掉它，用户会
    // 以为只是够不着，然后换个写法再试一次。
    if (error instanceof BlockedAddressError) throw error;
    // 页面读不到就往下走，不让这一步的失败替整件事下结论。
    return null;
  }
}

/**
 * 页面自带的 feed：`<link rel="alternate" type="application/rss+xml">`。读的是
 * 站点自己声明的订阅地址，不是从正文里猜——那条线在这里就到头了。
 */
async function pageFeeds(page: Page, url: URL): Promise<Candidate[]> {
  // 粘进来的本身就是一份 feed 时，它自己就是唯一那条候选。
  if (page.isFeed) {
    return [{ name: url.hostname, feedUrl: page.url, via: "page-feed", channelId: "rss" }];
  }

  const declared: Candidate[] = [];
  for (const tag of linkTags(page.body)) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(?:rss|atom)\+xml/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const title = /title\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    declared.push({
      name: title?.trim() || url.hostname,
      feedUrl: new URL(href, page.url).toString(),
      via: "page-feed",
      channelId: "rss",
    });
  }
  return withoutBlockedAddresses(declared);
}

function linkTags(body: string): string[] {
  return body.match(/<link\b[^>]*>/gi) ?? [];
}

/**
 * 约定路径：站点没在页面上声明订阅地址，但 feed 就摆在这几个位置上——Feedly
 * 与 Inoreader 都是这么找的。一条一条敲，敲到的东西要能被解析成 RSS/Atom 才
 * 算候选：只看 HTTP 200 会把一堆返回首页的软 404 当成 feed 加进来。
 *
 * 找着一条就停。同一个站点的 `/feed` 和 `/rss` 十有八九是同一份东西，列两条
 * 只是让用户多挑一次。整趟有时间上限——探测是粘网址时同步等着的。
 */
const wellKnownPaths = [
  "/feed",
  "/feed/",
  "/rss",
  "/rss.xml",
  "/atom.xml",
  "/index.xml",
  "/feed.xml",
];
const wellKnownBudgetMilliseconds = 10_000;
const wellKnownProbeMilliseconds = 3_000;

async function wellKnownPathFeeds(url: URL): Promise<Candidate[]> {
  const deadline = Date.now() + wellKnownBudgetMilliseconds;
  for (const path of wellKnownPaths) {
    if (Date.now() >= deadline) break;
    const probeUrl = new URL(path, url.origin).toString();
    try {
      const feed = await fetchFeed(probeUrl, { timeoutMilliseconds: wellKnownProbeMilliseconds });
      return [
        {
          name: feed.name || url.hostname,
          feedUrl: probeUrl,
          via: "well-known-path",
          channelId: "rss",
        },
      ];
    } catch {
      // 这个位置上没有 feed，敲下一个。
    }
  }
  return [];
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
 * 认得该域名的渠道适配器。这里每一条都是站点官方自己出的 feed，不经过任何
 * 中间层，也不需要登录态——Reddit 是唯一的例外，它进不了自采那一档，只能
 * 登记成 `agent-push` 端点由用户的 Agent 推进来（ADR 0011）。
 */
export function channelAdapterCandidates(url: URL, pageBody: string | null): Candidate[] {
  const host = url.hostname.replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "github.com") return githubCandidates(segments);
  if (host === "youtube.com" || host === "m.youtube.com") {
    return youtubeCandidates(url, segments, pageBody);
  }
  if (host === "v2ex.com") return v2exCandidates(segments);
  if (host.endsWith(".substack.com")) {
    const publication = host.replace(".substack.com", "");
    return [feedCandidate(`${publication} 的 Substack`, `https://${host}/feed`)];
  }
  if (host === "medium.com" || host.endsWith(".medium.com")) {
    return mediumCandidates(host, segments);
  }
  if (host === "reddit.com" || host === "old.reddit.com" || host === "np.reddit.com") {
    return redditCandidates(segments);
  }
  return [];
}

function feedCandidate(name: string, feedUrl: string): Candidate {
  return { name, feedUrl, via: "channel-adapter", channelId: "rss" };
}

/** 每个仓库自己就出 Atom。 */
function githubCandidates(segments: string[]): Candidate[] {
  const [owner, repo] = segments;
  if (!owner || !repo) return [];
  return [
    feedCandidate(
      `${owner}/${repo} 的 Releases`,
      `https://github.com/${owner}/${repo}/releases.atom`,
    ),
    feedCandidate(
      `${owner}/${repo} 的 Commits`,
      `https://github.com/${owner}/${repo}/commits.atom`,
    ),
  ];
}

/**
 * YouTube 官方给每个频道和播放列表出一份 Atom。频道 id 拿得到就直接拼；
 * `@handle` 与 `/user/x` 页面上没有 id，从刚读过的那份 HTML 里取——`canonical`
 * 指着 `/channel/<id>`，取不到就退到页面里那个 `"channelId"`。
 */
function youtubeCandidates(url: URL, segments: string[], pageBody: string | null): Candidate[] {
  const videoFeed = (label: string, query: string) =>
    feedCandidate(`${label} 的视频`, `https://www.youtube.com/feeds/videos.xml?${query}`);

  const playlist = url.searchParams.get("list");
  if (playlist) return [videoFeed(`YouTube 播放列表 ${playlist}`, `playlist_id=${playlist}`)];

  const [first, second] = segments;
  if (first === "channel" && second) {
    return [videoFeed(`YouTube 频道 ${second}`, `channel_id=${second}`)];
  }

  const label = first?.startsWith("@") ? first : first === "user" && second ? second : null;
  if (!label || !pageBody) return [];
  const channelId = youtubeChannelId(pageBody);
  return channelId ? [videoFeed(`YouTube 频道 ${label}`, `channel_id=${channelId}`)] : [];
}

function youtubeChannelId(body: string): string | null {
  for (const tag of linkTags(body)) {
    if (!/rel\s*=\s*["']?canonical/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const fromCanonical = href ? /\/channel\/([\w-]+)/.exec(href)?.[1] : undefined;
    if (fromCanonical) return fromCanonical;
  }
  return /"channelId"\s*:\s*"([\w-]+)"/.exec(body)?.[1] ?? null;
}

/** V2EX 每个节点一份 feed，首页一份。 */
function v2exCandidates(segments: string[]): Candidate[] {
  const [first, node] = segments;
  if (first === "go" && node) {
    return [feedCandidate(`V2EX 节点 ${node}`, `https://www.v2ex.com/feed/${node}.xml`)];
  }
  if (segments.length === 0) return [feedCandidate("V2EX 首页", "https://www.v2ex.com/index.xml")];
  return [];
}

function mediumCandidates(host: string, segments: string[]): Candidate[] {
  // 出版物用自己的子域名时，feed 就在它自己那个域名下。
  if (host !== "medium.com") return [feedCandidate(`${host} 的 Medium`, `https://${host}/feed`)];

  const [first] = segments;
  if (!first) return [];
  if (first.startsWith("@")) {
    return [feedCandidate(`${first} 的 Medium`, `https://medium.com/feed/${first}`)];
  }
  return [feedCandidate(`Medium 出版物 ${first}`, `https://medium.com/${first}/feed`)];
}

/**
 * Reddit 不进自采那一档（ADR 0011），所以这里给的不是一份 feed，而是一条
 * `agent-push` 端点：登记进来之后由用户自己的 Agent 采完推给 Radar，内容
 * 照样有来源归属、照样去重、照样能开关。
 */
function redditCandidates(segments: string[]): Candidate[] {
  const [first, subreddit] = segments;
  if (first !== "r" || !subreddit) return [];
  return [
    {
      name: `r/${subreddit}（你的 Agent 采集后推给 Radar）`,
      feedUrl: `https://www.reddit.com/r/${subreddit}`,
      via: "channel-adapter",
      channelId: "agent-push",
    },
  ];
}
