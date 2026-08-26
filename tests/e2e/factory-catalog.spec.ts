import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readFactoryCatalog } from "../../lib/catalog.js";
import { repositoryRoot } from "./support/radar-process.js";

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

  test("目录里的 url 不能重复——搬家只改 url，不新开一条", () => {
    const urls = catalog.endpoints.map((endpoint) => endpoint.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
