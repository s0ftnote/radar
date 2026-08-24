import { createServer, type Server } from "node:http";

export type FeedFixture = {
  url: string;
  publishChangedEntry(): void;
  breakFeed(): void;
  restoreFeed(): void;
  close(): Promise<void>;
};

export async function startFeedFixture(): Promise<FeedFixture> {
  let revision = 1;
  let malformed = false;
  const server = createServer((request, response) => {
    if (request.url === "/broken") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end("<rss><channel><item></rss>");
      return;
    }
    if (request.url === "/empty") {
      response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
      response.end(emptyRssDocument());
      return;
    }
    if (request.url !== "/feed") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    response.end(malformed ? "<rss><channel>broken" : rssDocument(revision));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Feed fixture did not bind a port.");

  return {
    url: `http://127.0.0.1:${address.port}`,
    publishChangedEntry: () => (revision += 1),
    breakFeed: () => (malformed = true),
    restoreFeed: () => (malformed = false),
    close: () => closeServer(server),
  };
}

function emptyRssDocument(): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0">
      <channel>
        <title>Empty Radar Fixture Feed</title>
        <link>https://example.test/empty-fixture</link>
        <description>A valid feed with no entries</description>
      </channel>
    </rss>`;
}

function rssDocument(revision: number): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0">
      <channel>
        <title>Radar Fixture Feed</title>
        <link>https://example.test/fixture</link>
        <description>Deterministic public feed fixture</description>
        <item>
          <guid isPermaLink="false">fixture-entry-1</guid>
          <title>Local-first tools ${revision === 1 ? "gain traction" : "become inspectable"}</title>
          <link>https://example.test/fixture-entry-${revision}</link>
          <pubDate>Mon, 24 Aug 2026 10:00:00 GMT</pubDate>
          <description>Revision ${revision}: developers want evidence they can keep.</description>
        </item>
      </channel>
    </rss>`;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
