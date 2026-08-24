import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startFeedFixture } from "./support/feed-fixture";
import { startProjectIsolationAgentFixture } from "./support/project-isolation-agent-fixture";
import { startRadar, stopRadar } from "./support/radar-process";

test("两个 Project 复用同一来源版本并保持判断完全隔离", async ({ browser }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "radar-project-isolation-"));
  const feed = await startFeedFixture();
  const agent = await startProjectIsolationAgentFixture();
  let radar = await startRadar(dataDirectory, 33123, { RADAR_AGENT_ENDPOINT: agent.endpoint });
  let context = await browser.newContext();
  let page = await context.newPage();

  try {
    await createProject(page, "共享来源 Project A", "Project A：寻找本地工具保留证据链的明确需求。");
    await createProject(page, "共享来源 Project B", "Project B：只收集可检查的竞争情报信号。");

    await page.getByRole("link", { name: /共享来源 Project A/ }).click();
    await expect(page.getByRole("heading", { name: "共享来源 Project A" })).toBeVisible();
    const projectAUrl = page.url();
    await page.getByLabel("公开 RSS/Atom URL").fill(`${feed.url}/empty`);
    await page.getByRole("button", { name: "验证并保存" }).click();

    await page.getByRole("link", { name: "Radar Projects" }).click();
    await page.getByRole("link", { name: /共享来源 Project B/ }).click();
    await expect(page.getByRole("heading", { name: "共享来源 Project B" })).toBeVisible();
    const projectBUrl = page.url();
    await expect(page.getByText("已有来源配置", { exact: true })).toBeVisible();
    await expect(page.getByText("本地实例已有尚未采集的来源。直接接入，不必再次验证 URL，然后运行首次采集。")).toBeVisible();
    const emptySavedSource = page.locator("article.available-source").filter({
      has: page.getByRole("heading", { name: "Empty Radar Fixture Feed", exact: true }),
    });
    await expect(emptySavedSource.getByText("尚未取得版本 · 1 个 Project 使用")).toBeVisible();

    await page.goto(projectAUrl);
    await page.getByLabel("公开 RSS/Atom URL").fill(`${feed.url}/feed`);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.locator(".network-notice")).toHaveText("本次新增 1 个来源版本");

    await page.goto(projectBUrl);
    const savedSource = page.locator("article.available-source").filter({
      has: page.getByRole("heading", { name: "Radar Fixture Feed", exact: true }),
    });
    await expect(savedSource.getByText("1 个已取得版本 · 1 个 Project 使用")).toBeVisible();
    await expect(savedSource.getByRole("link", { name: `${feed.url}/feed` })).toBeVisible();
    await expect(savedSource.getByText("健康", { exact: true })).toBeVisible();
    await page.route("**/api/projects/*/sources", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "已保存来源暂时无法接入，可以重试。" }),
      });
    }, { times: 1 });
    await savedSource.getByRole("button", { name: /^使用已保存来源 Radar Fixture Feed/ }).click();
    await expect(page.locator(".network-notice")).toHaveText("已保存来源暂时无法接入，可以重试。");
    await expect(savedSource).toBeVisible();
    await page.route("**/api/projects/*/sources", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    await savedSource.getByRole("button", { name: /^使用已保存来源 Radar Fixture Feed/ }).click();
    await expect(page.getByRole("button", { name: /^正在接入 Radar Fixture Feed/ })).toBeDisabled();
    await expect(page.locator(".network-notice")).toHaveText(
      "已从本地实例复用 Radar Fixture Feed 和 1 个来源版本；没有重新取得内容。",
    );
    await page.unroute("**/api/projects/*/sources");
    await expect(page.locator("article.source-row").getByText("2 个 Project 使用")).toBeVisible();
    await expect(page.getByRole("link", { name: "Local-first tools gain traction" })).toBeVisible();

    await page.goto(projectAUrl);
    await expect(page.locator("article.source-row").getByText("2 个 Project 使用")).toBeVisible();
    agent.delayNextProjectAResponse();
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.getByRole("button", { name: "正在判断…" })).toBeDisabled();
    const projectBObserver = await context.newPage();
    await projectBObserver.goto(projectBUrl);
    await expect(projectBObserver.getByRole("button", { name: "运行 Radar 判断" })).toBeEnabled();
    await expect(projectBObserver.getByText("正在判断", { exact: true })).toHaveCount(0);
    await projectBObserver.close();
    await expect(page.getByRole("heading", { name: "A 的本地证据需求" })).toBeVisible();
    const projectASharedVersionHref = await page
      .locator("article.intelligence-item")
      .getByRole("link", { name: /版本 1$/ })
      .getAttribute("href");
    expect(projectASharedVersionHref).toMatch(/^#source-version-/);

    await page.goto(projectBUrl);
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.getByText("Agent 调用失败，可以重试")).toBeVisible();
    await expect(page.getByText("还没有情报条目")).toBeVisible();

    await page.goto(projectAUrl);
    await expect(page.getByRole("heading", { name: "A 的本地证据需求" })).toBeVisible();
    await expect(page.getByText("Agent 调用失败，可以重试")).toHaveCount(0);

    await page.goto(projectBUrl);
    await page.getByRole("button", { name: "重试失败判断" }).click();
    await expect(page.getByRole("heading", { name: "B 的可检查竞争信号" })).toBeVisible();
    await expect(page.getByText("Agent 调用失败，可以重试")).toBeVisible();
    const projectBSharedVersionLink = page
      .locator("article.intelligence-item")
      .getByRole("link", { name: /版本 1$/ });
    await expect(projectBSharedVersionLink).toHaveAttribute("href", projectASharedVersionHref!);
    await projectBSharedVersionLink.click();
    expect(new URL(page.url()).hash).toBe(projectASharedVersionHref);
    await expect(page.locator(projectASharedVersionHref!)).toBeVisible();

    feed.publishChangedEntry();
    await page.goto(projectAUrl);
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.getByText("版本 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    const projectAItem = page.locator("article.intelligence-item").filter({
      has: page.getByRole("heading", { name: "A 的本地证据需求" }),
    });
    await expect(projectAItem.getByRole("blockquote")).toHaveCount(2);

    await page.goto(projectBUrl);
    await expect(page.getByText("版本 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.getByText("有效无匹配", { exact: true })).toBeVisible();
    await expect(page.getByText("这个版本不符合 Project B 的竞争信号边界。")).toBeVisible();
    await expect(page.locator("article.intelligence-item")).toHaveCount(1);

    await context.close();
    await stopRadar(radar);
    radar = await startRadar(dataDirectory, 33123, { RADAR_AGENT_ENDPOINT: agent.endpoint });
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(projectAUrl);
    await expect(page.getByRole("heading", { name: "A 的本地证据需求" })).toBeVisible();
    await expect(page.locator("article.intelligence-item").getByRole("blockquote")).toHaveCount(2);
    await page.goto(projectBUrl);
    await expect(page.getByRole("heading", { name: "B 的可检查竞争信号" })).toBeVisible();
    await expect(page.getByText("有效无匹配", { exact: true })).toBeVisible();
    await expect(page.locator("article.source-row").getByText("2 个 Project 使用")).toBeVisible();
  } finally {
    await context.close().catch(() => undefined);
    await stopRadar(radar).catch(() => undefined);
    await feed.close().catch(() => undefined);
    await agent.close().catch(() => undefined);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

async function createProject(page: Page, name: string, brief: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Project 名称").fill(name);
  await page.getByLabel("Radar Brief").fill(brief);
  await page.getByRole("button", { name: "创建 Radar Project" }).click();
  await expect(page.getByText(`${name} 已保存到本地。`)).toBeVisible();
}
