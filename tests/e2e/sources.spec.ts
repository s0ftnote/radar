import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startFeedFixture } from "./support/feed-fixture";
import { startRadar, stopRadar } from "./support/radar-process";

test("用户可以验证、采集、复用、修订并停止公开 RSS 来源", async ({ browser }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "radar-sources-"));
  const feed = await startFeedFixture();
  let radar = await startRadar(dataDirectory);
  let context = await browser.newContext();
  let page = await context.newPage();

  try {
    await page.goto("/");
    await page.getByLabel("Project 名称").fill("来源能力观察");
    await page.getByLabel("Radar Brief").fill("持续观察本地优先工具如何让来源事实保持可检查。");
    await page.getByRole("button", { name: "创建 Radar Project" }).click();
    await page.getByRole("link", { name: /来源能力观察/ }).click();

    await expect(page.getByRole("heading", { name: "Source Network" })).toBeVisible();
    await expect(page.getByText("还没有来源")).toBeVisible();

    await page.getByLabel("公开 RSS/Atom URL").fill(`${feed.url}/broken`);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await expect(page.getByText(/无法解析 RSS\/Atom/)).toBeVisible();
    await expect(page.getByText("还没有来源")).toBeVisible();

    await page.getByLabel("公开 RSS/Atom URL").fill(`${feed.url}/feed`);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await expect(page.getByRole("heading", { name: "Radar Fixture Feed" })).toBeVisible();
    await expect(page.getByText("已验证，等待首次采集")).toBeVisible();

    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.locator(".network-notice")).toHaveText("本次新增 1 个来源版本");
    await expect(page.getByText("Local-first tools gain traction")).toBeVisible();
    await expect(page.getByText("版本 1")).toBeVisible();

    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.locator(".network-notice")).toHaveText("未发现内容变化，复用 1 个来源版本");
    await expect(page.getByText("版本 1")).toHaveCount(1);

    feed.publishChangedEntry();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.getByText("Local-first tools become inspectable")).toBeVisible();
    await expect(page.getByText("版本 2")).toBeVisible();
    await expect(page.getByText("版本 1")).toBeVisible();
    await expect(page.getByRole("link", { name: "Local-first tools become inspectable" })).toHaveAttribute(
      "href",
      "https://example.test/fixture-entry-2",
    );
    await expect(page.getByRole("link", { name: "Local-first tools gain traction" })).toHaveAttribute(
      "href",
      "https://example.test/fixture-entry-1",
    );

    feed.breakFeed();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.getByText(/Feed XML 无效/)).toBeVisible();
    await expect(page.getByText("2 个不可变版本")).toBeVisible();
    await expect(page.getByText("Local-first tools gain traction")).toBeVisible();

    await page.getByRole("button", { name: "停止使用 Radar Fixture Feed" }).click();
    await expect(page.locator(".network-notice")).toHaveText("已停止后续采集，历史版本保留");
    await expect(page.getByText("2 个不可变版本")).toBeVisible();

    await context.close();
    await stopRadar(radar);
    feed.restoreFeed();
    radar = await startRadar(dataDirectory);
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto("/");
    await page.getByRole("link", { name: /来源能力观察/ }).click();
    await expect(page.getByRole("heading", { name: "Radar Fixture Feed" })).toBeVisible();
    await expect(page.getByText("已停止后续采集，历史版本保留")).toBeVisible();
    await expect(page.getByText("版本 2")).toBeVisible();
  } finally {
    await context.close();
    await stopRadar(radar);
    await feed.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
