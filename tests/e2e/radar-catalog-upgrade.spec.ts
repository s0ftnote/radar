import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { startFeedFixture, type FeedFixture } from "./support/feed-fixture.js";
import { createBriefWithAllSources, waitForFirstCollection, type Endpoint } from "./support/harness.js";
import {
  radar,
  radarJson,
  startRadar,
  stopRadar,
  type RadarEnvironment,
  type RunningRadar,
} from "./support/radar-process.js";

/**
 * 用户 `npm update -g` 升级之后：目录新增的源自动开始采，退役的自动停下并
 * 说清为什么，搬了家的接着采、历史一条不丢，自己加的源一律不碰。全程静默
 * （ADR 0014）。
 */

type WorkPackage = { pendingContents: Array<{ endpointId: string; queueEntryId: string }> };

async function writeCatalog(
  path: string,
  feed: FeedFixture,
  version: number,
  endpoints: Array<Record<string, unknown>>,
): Promise<void> {
  await writeFile(
    path,
    JSON.stringify({
      catalogVersion: version,
      channels: [
        { id: "rss", name: "RSS / Atom", configState: "ready", collectionIntervalSeconds: 900 },
        {
          id: "agent-push",
          name: "配置后解锁（Agent 推送）",
          configState: "unlocked_by_config",
          collectionIntervalSeconds: 900,
        },
      ],
      endpoints: endpoints.map((endpoint) => ({
        channelId: "rss",
        licenseBasis: { basis: "publisher-provided-feed", reference: `${feed.url}/terms` },
        ...endpoint,
      })),
    }),
  );
}

test.describe("出厂来源目录的升级对账", () => {
  test.describe.configure({ mode: "serial" });

  test("新增自动开、退役说清为什么、搬家历史接上、自己加的一律不碰", async () => {
    test.setTimeout(180_000);
    const dataDirectory = await mkdtemp(join(tmpdir(), "radar-upgrade-"));
    const feed = await startFeedFixture();
    feed.replacePage("/alpha-moved", [
      {
        guid: "alpha-1",
        title: "开发者抱怨证据留不住",
        body: "搬家之后同一条内容还是同一条。",
        publishedAt: "Mon, 24 Aug 2026 12:00:00 GMT",
      },
    ]);
    feed.replacePage("/gamma", []);
    feed.replacePage("/mine", []);

    const catalogPath = join(dataDirectory, "catalog.json");
    const environment: RadarEnvironment = { dataDirectory, catalogPath };
    await writeCatalog(catalogPath, feed, 1, [
      { id: "fixture-alpha", name: "Fixture Alpha", url: `${feed.url}/alpha` },
      { id: "fixture-beta", name: "Fixture Beta", url: `${feed.url}/beta` },
    ]);

    let radarProcess: RunningRadar = await startRadar(dataDirectory, { port: 33207, catalogPath });
    try {
      await waitForFirstCollection(environment);
      const brief = await createBriefWithAllSources<{ id: string }>(environment, "升级对账", "关注开发者留证据这件事。");
      const before = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      const alphaQueue = before.pendingContents.filter(
        (content) => content.endpointId === "fixture-alpha",
      );
      expect(alphaQueue.length).toBeGreaterThan(0);

      // 用户自己的两个决定：加一条源、停掉一条出厂源。
      const mine = await radarJson<Endpoint>(environment, [
        "sources", "add", "--channel", "rss", "--name", "我自己加的", "--url", `${feed.url}/mine`,
      ]);
      await radar(environment, ["sources", "disable", "fixture-beta"]);
      const beforeUpgrade = await radarJson<Endpoint[]>(environment, ["sources"]);
      const alphaBefore = beforeUpgrade.find((endpoint) => endpoint.id === "fixture-alpha")!;
      const betaBefore = beforeUpgrade.find((endpoint) => endpoint.id === "fixture-beta")!;
      expect(alphaBefore.lastSuccessAt).not.toBeNull();
      expect(betaBefore.userDisabledAt).not.toBeNull();

      // 升级：alpha 搬家、beta 退役、gamma 新增。
      await stopRadar(radarProcess);
      await writeCatalog(catalogPath, feed, 2, [
        { id: "fixture-alpha", name: "Fixture Alpha", url: `${feed.url}/alpha-moved` },
        { id: "fixture-beta", name: "Fixture Beta", url: `${feed.url}/beta`, retired: "上游停更了" },
        { id: "fixture-gamma", name: "Fixture Gamma", url: `${feed.url}/gamma` },
      ]);
      radarProcess = await startRadar(dataDirectory, { port: 33207, catalogPath });

      const after = await radarJson<Endpoint[]>(environment, ["sources"]);
      const find = (id: string) => after.find((endpoint) => endpoint.id === id)!;

      // 搬家只改 url：还是那一行，历史与来源状态原样接上。
      expect(find("fixture-alpha").url).toBe(`${feed.url}/alpha-moved`);
      expect(find("fixture-alpha").lastSuccessAt).toBe(alphaBefore.lastSuccessAt);
      const stillQueued = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(stillQueued.pendingContents.map((content) => content.queueEntryId))
        .toEqual(expect.arrayContaining(alphaQueue.map((content) => content.queueEntryId)));

      // 退役的自动停下并说清为什么，数据不删。
      expect(find("fixture-beta").retiredAt).not.toBeNull();
      expect(find("fixture-beta").retiredReason).toBe("上游停更了");
      // 而且没有覆盖用户自己那个停用决定——两个开关互不覆盖，对账也不会
      // 把用户手动停掉的源重新打开。
      expect(find("fixture-beta").userDisabledAt).toBe(betaBefore.userDisabledAt);

      // 新增的自动加入并默认开。
      expect(find("fixture-gamma").provenance).toBe("factory");
      expect(find("fixture-gamma").userDisabledAt).toBeNull();
      expect(find("fixture-gamma").retiredAt).toBeNull();

      // 自己加的一律不碰。
      expect(find(mine.id).provenance).toBe("user");
      expect(find(mine.id).url).toBe(`${feed.url}/mine`);
      expect(find(mine.id).userDisabledAt).toBeNull();
    } finally {
      await stopRadar(radarProcess);
      await feed.close();
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  test("地址被用户自己那条占着时先放着不动，腾出来之后自己跟上", async () => {
    test.setTimeout(180_000);
    const dataDirectory = await mkdtemp(join(tmpdir(), "radar-upgrade-clash-"));
    const feed = await startFeedFixture();
    feed.replacePage("/shared", []);
    const catalogPath = join(dataDirectory, "catalog.json");
    const environment: RadarEnvironment = { dataDirectory, catalogPath };
    await writeCatalog(catalogPath, feed, 1, [
      { id: "fixture-alpha", name: "Fixture Alpha", url: `${feed.url}/alpha` },
    ]);

    let radarProcess = await startRadar(dataDirectory, { port: 33209, catalogPath });
    try {
      // 用户先自己登记了这个地址。
      const mine = await radarJson<Endpoint>(environment, [
        "sources", "add", "--channel", "rss", "--name", "我先加的", "--url", `${feed.url}/shared`,
      ]);

      // 目录这一版把 alpha 搬到那个地址上：他那条不碰，alpha 也不半改。
      await stopRadar(radarProcess);
      await writeCatalog(catalogPath, feed, 2, [
        { id: "fixture-alpha", name: "改了名字", url: `${feed.url}/shared` },
      ]);
      radarProcess = await startRadar(dataDirectory, { port: 33209, catalogPath });

      const clashing = await radarJson<Endpoint[]>(environment, ["sources"]);
      const alpha = clashing.find((endpoint) => endpoint.id === "fixture-alpha")!;
      expect(alpha.url).toBe(`${feed.url}/alpha`);
      expect(alpha.name).toBe("Fixture Alpha");
      expect(clashing.find((endpoint) => endpoint.id === mine.id)!.url).toBe(`${feed.url}/shared`);

      // 用户把自己那条的地址腾开，下次起服务对账就自己跟上了。
      await radar(environment, ["sources", "disable", mine.id]);
      await stopRadar(radarProcess);
      const database = new DatabaseSync(join(dataDirectory, "radar.sqlite"));
      database.prepare("UPDATE endpoints SET url = ? WHERE id = ?")
        .run(`${feed.url}/mine-elsewhere`, mine.id);
      database.close();
      radarProcess = await startRadar(dataDirectory, { port: 33209, catalogPath });

      const caughtUp = await radarJson<Endpoint[]>(environment, ["sources"]);
      const moved = caughtUp.find((endpoint) => endpoint.id === "fixture-alpha")!;
      expect(moved.url).toBe(`${feed.url}/shared`);
      expect(moved.name).toBe("改了名字");
    } finally {
      await stopRadar(radarProcess);
      await feed.close();
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  test("版本号没变就什么都不做——目录随版本走，不在线拉取", async () => {
    test.setTimeout(120_000);
    const dataDirectory = await mkdtemp(join(tmpdir(), "radar-upgrade-same-"));
    const feed = await startFeedFixture();
    const catalogPath = join(dataDirectory, "catalog.json");
    const environment: RadarEnvironment = { dataDirectory, catalogPath };
    await writeCatalog(catalogPath, feed, 1, [
      { id: "fixture-alpha", name: "Fixture Alpha", url: `${feed.url}/alpha` },
    ]);

    let radarProcess = await startRadar(dataDirectory, { port: 33208, catalogPath });
    try {
      expect(await radarJson<Endpoint[]>(environment, ["sources"])).toHaveLength(1);

      // 目录内容变了但版本号没变：对账整个不走。
      await stopRadar(radarProcess);
      await writeCatalog(catalogPath, feed, 1, [
        { id: "fixture-alpha", name: "改了名字", url: `${feed.url}/alpha` },
        { id: "fixture-beta", name: "Fixture Beta", url: `${feed.url}/beta` },
      ]);
      radarProcess = await startRadar(dataDirectory, { port: 33208, catalogPath });

      const sources = await radarJson<Endpoint[]>(environment, ["sources"]);
      expect(sources).toHaveLength(1);
      expect(sources[0]!.name).toBe("Fixture Alpha");
    } finally {
      await stopRadar(radarProcess);
      await feed.close();
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });
});
