import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startAgentFixture } from "./support/agent-fixture";
import { startFeedFixture } from "./support/feed-fixture";
import { startRadar, stopRadar } from "./support/radar-process";

test.setTimeout(90_000);

test("用户可以把来源版本判断为可追溯且幂等的情报条目", async ({ browser }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "radar-intelligence-"));
  const feed = await startFeedFixture();
  const agent = await startAgentFixture();
  let radar = await startRadar(dataDirectory, 33123, {
    RADAR_AGENT_ENDPOINT: agent.endpoint,
    RADAR_AGENT_TOKEN: agent.token,
  });
  let context = await browser.newContext();
  let page = await context.newPage();

  try {
    await page.goto("/");
    await page.getByLabel("Project 名称").fill("可追溯需求判断");
    await page.getByLabel("Radar Brief").fill("寻找开发者对本地可检查证据链与出处优先研究流程的明确需求。");
    await page.getByRole("button", { name: "创建 Radar Project" }).click();
    await page.getByRole("link", { name: /可追溯需求判断/ }).click();

    await expect(page.getByRole("heading", { name: "Radar 判断" })).toBeVisible();
    await expect(page.getByText("还没有可判断的来源版本")).toBeVisible();

    await page.getByLabel("公开 RSS/Atom URL").fill(`${feed.url}/feed`);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.locator(".network-notice")).toHaveText("本次新增 1 个来源版本");

    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.getByRole("button", { name: "正在判断…" })).toBeDisabled();
    await expect(page.locator(".judgment-workbench")).toHaveAttribute("aria-busy", "true");
    const firstItem = page.locator("article.intelligence-item").filter({
      has: page.getByRole("heading", { name: "可检查的本地工作台需求" }),
    });
    await expect(firstItem).toBeVisible();
    await expect(firstItem.getByText("用户需要在本地保存可检查的来源事实与判断链。")).toBeVisible();
    await expect(firstItem.getByRole("blockquote")).toHaveText("Revision 1: developers want evidence they can keep.");
    await expect(firstItem.getByText(/来源正文 · 字符 \d+–\d+/)).toBeVisible();
    await expect(firstItem.getByText("当前判断")).toBeVisible();
    await expect(firstItem.getByText("来源原文")).toBeVisible();
    await expect(firstItem.getByText("Signal", { exact: true })).toBeVisible();
    await expect(firstItem.getByText("Source Network 来源", { exact: true })).toBeVisible();
    await expect(firstItem.getByText("来源内容", { exact: true })).toBeVisible();
    await expect(firstItem.getByText("来源版本", { exact: true })).toBeVisible();
    await expect(firstItem.getByText("Radar Brief 修订", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.locator(".judgment-notice")).toHaveText("复用 1 个已完成判断，没有重复创建情报条目。");
    expect(agent.requestCount()).toBe(1);
    await expect(page.getByRole("heading", { name: "可检查的本地工作台需求" })).toHaveCount(1);

    feed.publishChangedEntry();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.getByText("版本 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.locator(".judgment-notice")).toHaveText("1 个来源版本有效无匹配；情报库保持不变。");
    await expect(page.getByText("有效无匹配", { exact: true })).toBeVisible();
    await expect(page.getByText("这次内容变化没有形成新的需求判断。")).toBeVisible();
    await expect(page.getByRole("heading", { name: "可检查的本地工作台需求" })).toHaveCount(1);

    feed.publishChangedEntry();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.getByText("版本 3", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.locator(".judgment-notice")).toContainText("Agent 失败");
    await expect(page.getByText("Agent 调用失败，可以重试")).toBeVisible();
    await expect(page.getByRole("heading", { name: "可检查的本地工作台需求" })).toBeVisible();

    await page.getByRole("button", { name: "重试失败判断" }).click();
    await expect(page.getByRole("heading", { name: "出处优先的研究流程需求" })).toBeVisible();
    await expect(page.getByText("研究者需要让每项判断都能回到具体来源版本。")).toBeVisible();
    await expect(page.getByText("Agent 调用失败，可以重试")).toBeVisible();
    expect(agent.requestCount()).toBe(4);

    await expect(page.getByText(agent.token)).toHaveCount(0);
    await context.close();
    await stopRadar(radar);
    radar = await startRadar(dataDirectory, 33123, {
      RADAR_AGENT_ENDPOINT: agent.endpoint,
      RADAR_AGENT_TOKEN: agent.token,
    });
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto("/");
    await page.getByRole("link", { name: /可追溯需求判断/ }).click();
    await expect(page.getByRole("heading", { name: "可检查的本地工作台需求" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "出处优先的研究流程需求" })).toBeVisible();
    await expect(page.getByText("Agent 调用失败，可以重试")).toBeVisible();
    await expect(page.getByText("版本 1", { exact: true })).toBeVisible();
    await expect(page.locator("article.intelligence-item").first().getByText("Radar Brief 修订", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.locator(".judgment-notice")).toHaveText("复用 3 个已完成判断，没有重复创建情报条目。");
    expect(agent.requestCount()).toBe(4);

    feed.publishChangedEntry();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.getByText("版本 4", { exact: true })).toBeVisible();
    agent.delayNextResponse();
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.getByRole("button", { name: "正在判断…" })).toBeDisabled();
    await expect.poll(() => agent.requestCount()).toBe(5);
    await context.close();
    await stopRadar(radar);

    radar = await startRadar(dataDirectory, 33123, {
      RADAR_AGENT_ENDPOINT: agent.endpoint,
      RADAR_AGENT_TOKEN: agent.token,
    });
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto("/");
    await page.getByRole("link", { name: /可追溯需求判断/ }).click();
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    const repeatedIdentityItem = page.locator("article.intelligence-item").filter({
      has: page.getByRole("heading", { name: "可检查的本地工作台需求" }),
    });
    await expect(repeatedIdentityItem.getByRole("blockquote")).toHaveCount(2);
    await expect(repeatedIdentityItem.getByRole("blockquote").nth(1)).toHaveText(
      "Revision 4: developers want evidence they can keep.",
    );
    await expect(page.locator("article.intelligence-item")).toHaveCount(2);
    await expect(page.getByText("Radar 在 Agent 返回前停止；可以重试。")).toBeVisible();
    expect(agent.requestCount()).toBe(6);

    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.locator(".judgment-notice")).toHaveText("复用 4 个已完成判断，没有重复创建情报条目。");
    expect(agent.requestCount()).toBe(6);
  } finally {
    await context.close().catch(() => undefined);
    await stopRadar(radar).catch(() => undefined);
    await feed.close().catch(() => undefined);
    await agent.close().catch(() => undefined);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
