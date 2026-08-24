import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startRadar, stopRadar } from "./support/radar-process";

test("用户可以创建、区分、重新打开并在重启后保留 Radar Project", async ({ browser }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "radar-projects-"));
  let radar = await startRadar(dataDirectory);
  let context = await browser.newContext();
  let page = await context.newPage();

  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "你的 Radar Projects" })).toBeVisible();
    await expect(page.getByText("还没有 Radar Project")).toBeVisible();

    await page.getByLabel("Project 名称").fill("Agent 工具需求");
    await page
      .getByLabel("Radar Brief")
      .fill("持续判断独立开发者在构建 AI Agent 时反复遇到的工具缺口。");
    await page.getByRole("button", { name: "创建 Radar Project" }).click();
    await expect(page.getByRole("link", { name: /Agent 工具需求/ })).toBeVisible();

    await page.getByLabel("Project 名称").fill("本地优先产品");
    await page
      .getByLabel("Radar Brief")
      .fill("关注用户真正拥有数据和运行权的本地优先软件实践。");
    await page.getByRole("button", { name: "创建 Radar Project" }).click();
    await expect(page.getByRole("link", { name: /本地优先产品/ })).toBeVisible();

    await page.getByRole("link", { name: /Agent 工具需求/ }).click();
    await expect(page.getByRole("heading", { name: "Agent 工具需求" })).toBeVisible();
    await expect(page.getByText("持续判断独立开发者在构建 AI Agent 时反复遇到的工具缺口。"))
      .toBeVisible();
    await expect(page.getByText("Brief 修订 1")).toBeVisible();

    await context.close();
    await stopRadar(radar);
    radar = await startRadar(dataDirectory);
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Agent 工具需求/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /本地优先产品/ })).toBeVisible();
    await page.getByRole("link", { name: /本地优先产品/ }).click();
    await expect(page.getByRole("heading", { name: "本地优先产品" })).toBeVisible();
    await expect(page.getByText("关注用户真正拥有数据和运行权的本地优先软件实践。"))
      .toBeVisible();
    await page.getByRole("link", { name: "Radar Projects" }).click();
    await page.getByRole("link", { name: /Agent 工具需求/ }).click();
    await expect(page.getByText("持续判断独立开发者在构建 AI Agent 时反复遇到的工具缺口。"))
      .toBeVisible();
  } finally {
    await context.close();
    await stopRadar(radar);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
