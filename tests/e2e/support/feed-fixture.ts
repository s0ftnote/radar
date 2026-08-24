import { createServer, type Server } from "node:http";

export type FeedFixture = {
  url: string;
  publishChangedEntry(): void;
  delayNextResponse(): void;
  breakFeed(): void;
  restoreFeed(): void;
  useCredentialedEntryUrl(): void;
  close(): Promise<void>;
};

export async function startFeedFixture(): Promise<FeedFixture> {
  let revision = 1;
  let malformed = false;
  let delayNextResponse = false;
  let credentialedEntryUrl = false;
  const server = createServer(async (request, response) => {
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
    if (request.url === "/fallback") {
      response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
      response.end(fallbackIdentityRssDocument());
      return;
    }
    if (request.url !== "/feed") {
      response.writeHead(404).end();
      return;
    }
    if (delayNextResponse) {
      delayNextResponse = false;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    response.end(malformed ? "<rss><channel>broken" : rssDocument(revision, credentialedEntryUrl));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Feed fixture did not bind a port.");

  return {
    url: `http://127.0.0.1:${address.port}`,
    publishChangedEntry: () => (revision += 1),
    delayNextResponse: () => (delayNextResponse = true),
    breakFeed: () => (malformed = true),
    restoreFeed: () => (malformed = false),
    useCredentialedEntryUrl: () => (credentialedEntryUrl = true),
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

function fallbackIdentityRssDocument(): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0">
      <channel>
        <title>Fallback Identity Feed</title>
        <link>https://example.test/fallback-fixture</link>
        <description>Valid entries without guid or link</description>
        <item>
          <title>Identity fallback alpha</title>
          <pubDate>Mon, 24 Aug 2026 08:00:00 GMT</pubDate>
          <description>Alpha stays distinct.</description>
        </item>
        <item>
          <title>Identity fallback beta</title>
          <pubDate>Mon, 24 Aug 2026 09:00:00 GMT</pubDate>
          <description>Beta stays distinct.</description>
        </item>
      </channel>
    </rss>`;
}

function rssDocument(revision: number, credentialedEntryUrl: boolean): string {
  const entryUrl = credentialedEntryUrl
    ? `https://reader:source-fixture-secret@example.test/fixture-entry-${revision}?access_token=source-fixture-secret&amp;utm_source=radar`
    : `https://example.test/fixture-entry-${revision}`;
  return `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0">
      <channel>
        <title>Radar Fixture Feed</title>
        <link>https://example.test/fixture</link>
        <description>Deterministic public feed fixture</description>
        <item>
          <guid isPermaLink="false">fixture-entry-1</guid>
          <title>Local-first tools ${revision === 1 ? "gain traction" : "become inspectable"}</title>
          <link>${entryUrl}</link>
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
