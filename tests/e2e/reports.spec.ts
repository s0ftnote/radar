import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startFeedFixture } from "./support/feed-fixture";
import { startRadar, stopRadar } from "./support/radar-process";
import { startReportAgentFixture } from "./support/report-agent-fixture";

test.setTimeout(90_000);

test("用户从情报修订生成固定且可追溯的 Report", async ({ browser }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "radar-reports-"));
  const feed = await startFeedFixture();
  const agent = await startReportAgentFixture();
  let radar = await startRadar(dataDirectory, 33123, {
    RADAR_AGENT_ENDPOINT: agent.endpoint,
    RADAR_AGENT_TOKEN: agent.token,
  });
  let context = await browser.newContext();
  let page = await context.newPage();

  try {
    await page.goto("/");
    await page.getByLabel("Project 名称").fill("固定 Report 观察");
    await page.getByLabel("Radar Brief").fill("寻找需要把本地证据组织成可追溯输出的明确需求。");
    await page.getByRole("button", { name: "创建 Radar Project" }).click();
    await page.getByRole("link", { name: /固定 Report 观察/ }).click();
    await expect(page.getByRole("heading", { name: "固定 Report 观察" })).toBeVisible();
    const projectUrl = page.url();

    await page.getByLabel("公开 RSS/Atom URL").fill(`${feed.url}/feed`);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.getByRole("heading", { name: "可报告的本地证据需求" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "生成固定 Report" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expect(page.getByText("还没有 Report")).toBeVisible();
    await expect(page.getByRole("button", { name: "生成 Report" })).toBeDisabled();
    await page.getByLabel("选择 可报告的本地证据需求 修订 1").check();
    await expect(page.getByRole("button", { name: "生成 Report" })).toBeEnabled();
    await page.getByLabel("内容目的").fill("解释本地证据工作流");
    await page.getByLabel("目标受众").fill("构建个人情报工具的产品工程师");
    await page.getByLabel("核心角度").fill("证据链比内容堆叠更重要");
    await page.route("**/api/projects/*/reports", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    await page.getByRole("button", { name: "生成 Report" }).click();
    await expect(page.getByRole("button", { name: "正在生成 Report…" })).toBeDisabled();
    await expect(page.locator(".report-workbench")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("heading", { name: "解释本地证据工作流 · 固定快照" })).toBeVisible();
    await page.unroute("**/api/projects/*/reports");

    const firstReport = page.locator("article.report-record").first();
    await expect(firstReport.getByText("构建个人情报工具的产品工程师")).toBeVisible();
    await expect(firstReport.getByText("证据链比内容堆叠更重要")).toBeVisible();
    await expect(firstReport.getByText("手动生成", { exact: true })).toBeVisible();
    await expect(firstReport.getByText("固定输入", { exact: true })).toBeVisible();
    await expect(firstReport.getByRole("link", { name: "可报告的本地证据需求 · 修订 1" })).toBeVisible();
    await expect(firstReport.getByText("可报告的本地证据需求：开发者需要把本地证据链组织成可追溯主张。")).toBeVisible();
    await expect(firstReport.getByText("推断", { exact: true })).toBeVisible();
    for (const linkName of ["情报条目修订 1", "Signal 证据", "来源版本 1"]) {
      const upstreamLink = firstReport.getByRole("link", { name: linkName });
      const href = await upstreamLink.getAttribute("href");
      expect(href).toMatch(/^#/);
      await upstreamLink.click();
      expect(new URL(page.url()).hash).toBe(href);
      await expect(page.locator(href!)).toBeVisible();
    }
    const firstReportId = await firstReport.getByText(/^Report 身份/).textContent();
    const firstGenerationRun = page.locator("li.report-run").first();
    await expect(firstGenerationRun.getByText(/^运行身份/)).toBeVisible();
    await expect(firstGenerationRun.getByText(/^开始时间/)).toBeVisible();
    await expect(firstGenerationRun.getByRole("link", { name: "打开对应 Report" })).toBeVisible();
    await page.getByRole("button", { name: "生成 Report" }).click();
    await expect(page.locator("article.report-record")).toHaveCount(2);
    const secondReportId = await page.locator("article.report-record").first().getByText(/^Report 身份/).textContent();
    expect(secondReportId).not.toBe(firstReportId);

    await page.getByLabel("核心角度").fill("先失败后恢复的证据角度");
    await page.getByRole("button", { name: "生成 Report" }).click();
    await expect(page.locator(".report-notice")).toContainText("Report 生成失败");
    const failedRun = page.locator("li.report-run").filter({ hasText: "先失败后恢复的证据角度" });
    await expect(page.getByRole("heading", { name: "重试 Report 生成" })).toBeVisible();
    await expect(failedRun.getByText("失败", { exact: true })).toBeVisible();
    await expect(failedRun).toContainText("Agent 返回 HTTP 503");
    await expect(failedRun.getByText("解释本地证据工作流")).toBeVisible();
    await expect(failedRun.getByRole("link", { name: "可报告的本地证据需求 · 修订 1" })).toBeVisible();
    await expect(failedRun.getByRole("link", { name: "固定 Signal 1" })).toBeVisible();
    await expect(page.locator("article.report-record")).toHaveCount(2);

    await failedRun.getByRole("button", { name: "重试这次生成" }).click();
    await expect(page.locator("article.report-record")).toHaveCount(3);
    await expect(page.getByText("Agent 返回 HTTP 503")).toBeVisible();
    await expect(page.locator("li.report-run").first().getByText(/^重试自运行/)).toBeVisible();

    feed.publishChangedEntry();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await page.getByRole("button", { name: "运行 Radar 判断" }).click();
    await expect(page.locator("article.intelligence-item").getByRole("blockquote")).toHaveCount(2);
    await expect(page.locator("article.report-record").getByText(
      "Revision 2: developers want evidence they can keep.",
    )).toHaveCount(0);
    await expect(page.locator("article.report-record .report-claim-evidence")).toHaveCount(3);

    await expect(page.getByText(agent.token)).toHaveCount(0);
    await context.close();
    await stopRadar(radar);
    radar = await startRadar(dataDirectory, 33123, {
      RADAR_AGENT_ENDPOINT: agent.endpoint,
      RADAR_AGENT_TOKEN: agent.token,
    });
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(projectUrl);
    await expect(page.locator("article.report-record")).toHaveCount(3);
    await expect(page.getByText("Agent 返回 HTTP 503")).toBeVisible();
    await expect(page.getByText("先失败后恢复的证据角度", { exact: true })).toBeVisible();
    await expect(page.locator("article.report-record").getByText(
      "Revision 2: developers want evidence they can keep.",
    )).toHaveCount(0);
  } finally {
    await context.close().catch(() => undefined);
    await stopRadar(radar).catch(() => undefined);
    await feed.close().catch(() => undefined);
    await agent.close().catch(() => undefined);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
