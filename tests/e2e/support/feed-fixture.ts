import { createServer, type Server } from "node:http";

export type FixtureEntry = { guid: string; title: string; body: string; publishedAt: string };

export type FeedFixture = {
  url: string;
  /** 换掉某条的标题与正文，guid 不变——同一条被编辑，不该变成新内容。 */
  editEntry(guid: string, changes: { title?: string; body?: string }): void;
  addEntry(entry: FixtureEntry): void;
  /** 换掉整页：老条目从 feed 上下架了，Radar 库里还留着它们。 */
  replacePage(path: string, entries: FixtureEntry[]): void;
  /** 让下一次请求慢下来，制造「上一次采集还没结束」。 */
  delayNextResponse(milliseconds: number): void;
  breakFeed(): void;
  restoreFeed(): void;
  requestCount(path: string): number;
  close(): Promise<void>;
};

const alphaEntries: FixtureEntry[] = [
  {
    guid: "alpha-1",
    title: "开发者抱怨证据留不住",
    body: "帖子里反复出现同一个诉求：删帖之后引用就断了。",
    publishedAt: "Mon, 24 Aug 2026 12:00:00 GMT",
  },
  {
    guid: "alpha-2",
    title: "招聘帖：我们在招后端",
    body: "一条跟关注目标无关的招聘帖。",
    publishedAt: "Mon, 24 Aug 2026 11:30:00 GMT",
  },
];

const betaEntries: FixtureEntry[] = [
  {
    guid: "beta-1",
    title: "本地优先工具的取舍讨论",
    body: "讨论集中在同步与所有权之间怎么选。",
    publishedAt: "Mon, 24 Aug 2026 11:00:00 GMT",
  },
];

export async function startFeedFixture(): Promise<FeedFixture> {
  const feeds = new Map<string, FixtureEntry[]>([
    ["/alpha", structuredClone(alphaEntries)],
    ["/beta", structuredClone(betaEntries)],
  ]);
  const counts = new Map<string, number>();
  let malformed = false;
  let delayNext = 0;

  const server = createServer(async (request, response) => {
    const path = request.url ?? "/";
    counts.set(path, (counts.get(path) ?? 0) + 1);
    const entries = feeds.get(path);
    if (!entries) {
      response.writeHead(404).end();
      return;
    }
    if (delayNext > 0) {
      const pause = delayNext;
      delayNext = 0;
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
    if (malformed) {
      response.writeHead(500, { "content-type": "text/plain" }).end("feed is down");
      return;
    }
    response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    response.end(rssDocument(path, entries));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Feed fixture did not bind a port.");

  return {
    url: `http://127.0.0.1:${address.port}`,
    editEntry: (guid, changes) => {
      for (const entries of feeds.values()) {
        const entry = entries.find((candidate) => candidate.guid === guid);
        if (entry) Object.assign(entry, changes);
      }
    },
    addEntry: (entry) => feeds.get("/alpha")!.unshift(entry),
    replacePage: (path, entries) => feeds.set(path, structuredClone(entries)),
    delayNextResponse: (milliseconds) => (delayNext = milliseconds),
    breakFeed: () => (malformed = true),
    restoreFeed: () => (malformed = false),
    requestCount: (path) => counts.get(path) ?? 0,
    close: () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function rssDocument(path: string, entries: FixtureEntry[]): string {
  const items = entries
    .map(
      (entry) => `
        <item>
          <guid isPermaLink="false">${entry.guid}</guid>
          <title>${escapeXml(entry.title)}</title>
          <link>https://example.test${path}/${entry.guid}</link>
          <pubDate>${entry.publishedAt}</pubDate>
          <description>${escapeXml(entry.body)}</description>
        </item>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0">
      <channel>
        <title>Radar Fixture${path}</title>
        <link>https://example.test${path}</link>
        <description>Deterministic public feed fixture</description>${items}
      </channel>
    </rss>`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
