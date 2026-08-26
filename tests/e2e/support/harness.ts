import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFeedFixture, type FeedFixture } from "./feed-fixture.js";
import {
  delay,
  radarJson,
  startRadar,
  stopRadar,
  type RadarEnvironment,
  type RunningRadar,
} from "./radar-process.js";

import type { Endpoint } from "../../../lib/endpoints.js";

export type { Endpoint };

export async function fixtureCatalog(
  directory: string,
  feed: FeedFixture,
  collectionIntervalSeconds = 900,
): Promise<string> {
  const path = join(directory, "catalog.json");
  await writeFile(
    path,
    JSON.stringify({
      catalogVersion: 1,
      channels: [
        { id: "rss", name: "RSS / Atom", configState: "ready", collectionIntervalSeconds },
        {
          id: "agent-push",
          name: "配置后解锁（Agent 推送）",
          configState: "unlocked_by_config",
          collectionIntervalSeconds,
        },
      ],
      endpoints: [
        {
          id: "fixture-alpha",
          channelId: "rss",
          name: "Fixture Alpha",
          url: `${feed.url}/alpha`,
          licenseBasis: { basis: "publisher-provided-feed", reference: `${feed.url}/terms` },
        },
        {
          id: "fixture-beta",
          channelId: "rss",
          name: "Fixture Beta",
          url: `${feed.url}/beta`,
          licenseBasis: { basis: "publisher-provided-feed", reference: `${feed.url}/terms` },
        },
      ],
    }),
  );
  return path;
}

export type Harness = {
  environment: RadarEnvironment;
  feed: FeedFixture;
  radarProcess: RunningRadar;
  dispose(): Promise<void>;
};

export async function startHarness(
  label: string,
  port: number,
  collectionIntervalSeconds?: number,
): Promise<Harness> {
  const dataDirectory = await mkdtemp(join(tmpdir(), `radar-${label}-`));
  const feed = await startFeedFixture();
  const catalogPath = await fixtureCatalog(dataDirectory, feed, collectionIntervalSeconds);
  const environment = { dataDirectory, catalogPath };
  const radarProcess = await startRadar(dataDirectory, { port, catalogPath });
  return {
    environment,
    feed,
    radarProcess,
    dispose: async () => {
      await stopRadar(radarProcess);
      await feed.close();
      await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}


/** 等首采落地：服务起来立刻首采，端点见过内容就算到位。 */
export async function waitForFirstCollection(
  environment: RadarEnvironment,
): Promise<Endpoint[]> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const endpoints = await radarJson<Endpoint[]>(environment, ["sources"]);
    if (endpoints.every((endpoint) => endpoint.status !== "recently_failed")) {
      const runs = endpoints.filter((endpoint) => endpoint.id.startsWith("fixture-"));
      if (runs.length === 2) return endpoints;
    }
    await delay(100);
  }
  throw new Error("等首采超时。");
}
