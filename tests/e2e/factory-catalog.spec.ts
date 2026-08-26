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
    expect(ids).toEqual(["hacker-news-frontpage", "lobsters-frontpage", "github-changelog"]);
    expect(new Set(ids).size).toBe(ids.length);

    const channelIds = new Set(catalog.channels.map((channel) => channel.id));
    for (const endpoint of catalog.endpoints) {
      expect(channelIds).toContain(endpoint.channelId);
    }
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
