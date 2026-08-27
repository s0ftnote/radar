import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readFactoryCatalog } from "../../lib/catalog.js";
import type { Endpoint } from "../../lib/endpoints.js";
import {
  radarJson,
  repositoryRoot,
  startRadar,
  stopRadar,
  type RadarEnvironment,
  type RunningRadar,
} from "./support/radar-process.js";

/**
 * 随版本发出去的那份目录本身也要验收——别的用例都用 RADAR_CATALOG 顶掉了它，
 * 它要是解析不了或缺许可依据，用户装好第一眼就撞上（ADR 0014）。
 */
test.describe("出厂来源目录", () => {
  const catalog = readFactoryCatalog(resolve(repositoryRoot, "data/factory-catalog.json"));

  test("解析得开，端点 id 稳定且不重复，渠道都指得到", () => {
    const ids = catalog.endpoints.map((endpoint) => endpoint.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 发布过的 id 永不复用、永不改写：目录只增不改名，搬家改 url（ADR 0014）。
    expect(ids).toEqual(
      expect.arrayContaining(["hacker-news-frontpage", "lobsters-frontpage", "github-changelog"]),
    );

    const channelIds = new Set(catalog.channels.map((channel) => channel.id));
    for (const endpoint of catalog.endpoints) {
      expect(channelIds).toContain(endpoint.channelId);
    }
  });

  // 出厂自带尽量多的来源、默认几乎全开：装好即用的骨干要有，`radar push`
  // 也得开箱就有落点，否则「配置后解锁」那一档在出厂状态下根本走不通。
  test("三档渠道各自有端点，装好即用与配置后解锁都不空", () => {
    const channelById = new Map(catalog.channels.map((channel) => [channel.id, channel]));
    const states = catalog.endpoints.map(
      (endpoint) => channelById.get(endpoint.channelId)!.configState,
    );
    expect(states.filter((state) => state === "ready").length).toBeGreaterThanOrEqual(3);
    expect(states).toContain("unlocked_by_config");
  });

  test("每条出厂端点都写下了机器可读的许可依据", () => {
    for (const endpoint of catalog.endpoints) {
      const basis = endpoint.licenseBasis as { basis?: string; reference?: string } | null;
      expect(basis?.basis, `${endpoint.id} 缺许可依据`).toBeTruthy();
      expect(basis?.reference, `${endpoint.id} 缺许可依据出处`).toMatch(/^https:\/\//);
    }
  });

  // 建 Brief 时按需求挑源靠的就是 topics（ADR 0018）：没标的那条永远不会被挑中。
  test("每条出厂端点都标了 topics，且用的是同一个小词表", () => {
    // 词表小才挑得动：同一个领域两种写法，Agent 就会漏掉其中一半。加新词是
    // 显式动作，改这里一行——目录不因此长出分类体系（ADR 0014）。
    const vocabulary = new Set([
      "ai",
      "chinese-tech",
      "devtools",
      "hardware",
      "opensource",
      "podcast",
      "product",
      "science",
      "security",
      "startups",
      "systems",
      "video",
      "webdev",
    ]);
    for (const endpoint of catalog.endpoints) {
      expect(endpoint.topics?.length, `${endpoint.id} 没标 topics`).toBeGreaterThan(0);
      for (const topic of endpoint.topics!) {
        expect(topic).toMatch(/^[a-z][a-z-]*$/);
        expect(vocabulary, `${endpoint.id} 的 topic「${topic}」不在词表里`).toContain(topic);
      }
    }
  });

  test("目录里的 url 不能重复——搬家只改 url，不新开一条", () => {
    const urls = catalog.endpoints.map((endpoint) => endpoint.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

/**
 * 出厂目录是一份目录，不是一份订阅（ADR 0018）。这一组用的是随版本发出去的
 * 那份真目录，验的正是新装实例第一刻的样子：79 条端点都登记着，一条都不在采，
 * 因此一个请求都不发——否则装好就是替用户订了几十份他没开口要的东西（#104）。
 */
test.describe("装好之后、第一条 Brief 之前", () => {
  test.describe.configure({ mode: "serial" });

  const catalog = readFactoryCatalog(resolve(repositoryRoot, "data/factory-catalog.json"));
  let dataDirectory: string;
  let environment: RadarEnvironment;
  let radarProcess: RunningRadar;
  let origin: string;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    dataDirectory = await mkdtemp(join(tmpdir(), "radar-fresh-"));
    // 不给 RADAR_CATALOG：这一组要的就是随版本发出去的那份真目录。
    environment = { dataDirectory };
    radarProcess = await startRadar(dataDirectory, { port: 33220 });
    origin = `http://127.0.0.1:${radarProcess.port}`;
  });

  test.afterAll(async () => {
    await stopRadar(radarProcess);
    await rm(dataDirectory, { recursive: true, force: true });
  });

  test("整份目录都登记着，但一条都不在采，催也不采", async () => {
    test.setTimeout(120_000);
    // 目录整份都在，每条都是「未纳入」——登记着不等于在采。
    const all = await radarJson<Endpoint[]>(environment, ["sources", "--catalog"]);
    expect(all).toHaveLength(catalog.endpoints.length);
    expect(all.every((endpoint) => endpoint.includedInBriefs.length === 0)).toBe(true);
    expect(
      all.filter((endpoint) => endpoint.channelConfigState === "ready")
        .every((endpoint) => endpoint.status === "not_included"),
    ).toBe(true);

    // 在采的一条都没有。
    expect(await radarJson<Endpoint[]>(environment, ["sources"])).toEqual([]);

    // --topic 从目录里要一小片，而不是把 79 行一口气吐出来。
    const slice = await radarJson<Endpoint[]>(environment, ["sources", "--catalog", "--topic", "ai"]);
    expect(slice.length).toBeGreaterThan(0);
    expect(slice.length).toBeLessThan(all.length);
    expect(slice.every((endpoint) => endpoint.topics.includes("ai"))).toBe(true);
    // 两个筛子叠加：在采的那一片里，ai 这个领域现在什么都没有。
    expect(await radarJson<Endpoint[]>(environment, ["sources", "--topic", "ai"])).toEqual([]);

    // 催一次全实例采集：每一条都如实说「没人要」，一次网络请求都没发出去。
    const results = await radarJson<Array<{ status: string; skippedBecause?: string }>>(
      environment, ["collect"],
    );
    expect(results).toHaveLength(catalog.endpoints.length);
    expect(results.every((result) => result.status === "skipped")).toBe(true);
    expect(
      results.filter((result) => result.skippedBecause === "not_included").length,
    ).toBeGreaterThan(0);

    // 没有任何一条端点留下过采集尝试——真的一个请求都没发。
    const after = await radarJson<Endpoint[]>(environment, ["sources", "--catalog"]);
    expect(after.every((endpoint) => endpoint.lastAttemptAt === null)).toBe(true);
    expect(after.every((endpoint) => endpoint.lastSuccessAt === null)).toBe(true);
  });

  test("两张网页都说下一步该做什么，不假装有东西", async () => {
    const content = await (await fetch(`${origin}/`)).text();
    expect(content).toContain("还没有 Brief");
    expect(content).toContain("先跟你的 Agent 说你想持续知道什么");
    expect(content).not.toContain('<ul class="contents">');

    const sources = await (await fetch(`${origin}/sources`)).text();
    // 在采的那半是空的，目录那半摆着还能加的，但没有 Brief 可纳入。
    expect(sources).toContain("在采的");
    expect(sources).toContain("目录里还能加的");
    expect(sources).not.toContain('<ul class="sources">');
    expect(sources).toContain("还没有 Brief");
  });
});
