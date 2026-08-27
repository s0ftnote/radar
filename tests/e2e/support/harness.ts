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
          topics: ["devtools", "systems"],
          licenseBasis: { basis: "publisher-provided-feed", reference: `${feed.url}/terms` },
        },
        {
          id: "fixture-beta",
          channelId: "rss",
          name: "Fixture Beta",
          url: `${feed.url}/beta`,
          topics: ["product"],
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
  privateDiscoveryHosts: string[] = [],
  extraEnv?: NodeJS.ProcessEnv,
): Promise<Harness> {
  const dataDirectory = await mkdtemp(join(tmpdir(), `radar-${label}-`));
  const feed = await startFeedFixture();
  const catalogPath = await fixtureCatalog(dataDirectory, feed, collectionIntervalSeconds);
  const environment = { dataDirectory, catalogPath, privateDiscoveryHosts, extraEnv };
  const radarProcess = await startRadar(dataDirectory, {
    port,
    catalogPath,
    privateDiscoveryHosts,
    extraEnv,
  });
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


/**
 * 建一条 Brief，并把此刻登记着的端点全部纳入它。一条 Brief 只看它纳入的端点
 * （ADR 0018），不纳入什么都看不到——用例关心的多半不是挑源本身，那就把这台
 * Radar 现有的来源整批纳入，回到「这条 Brief 看得见所有采到的东西」。
 */
export async function createBriefWithAllSources<T extends { id: string }>(
  environment: RadarEnvironment,
  name: string,
  body: string,
): Promise<T> {
  const brief = await radarJson<T>(environment, ["brief", "create", "--name", name], body);
  for (const endpoint of await radarJson<Endpoint[]>(environment, ["sources"])) {
    await radarJson(environment, ["sources", "include", endpoint.id, "--brief", brief.id]);
  }
  return brief;
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
