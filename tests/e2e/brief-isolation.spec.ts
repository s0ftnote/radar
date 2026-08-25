import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { startFeedFixture } from "./support/feed-fixture";
import { startRadar, stopRadar } from "./support/radar-process";

type JudgmentsView = {
  pendingContents: Array<{ id: string; title: string; sourceName: string }>;
  judgments: Array<{
    id: string;
    sourceContentId: string;
    relevant: boolean;
    reason: string;
    signals: Array<{ sourceContentId: string; title: string }>;
  }>;
};

test.setTimeout(90_000);

test("两个 Brief 共享同一份来源内容并保持判断完全隔离", async ({ browser }) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "radar-brief-isolation-"));
  const feed = await startFeedFixture();
  let radar = await startRadar(dataDirectory);
  let context = await browser.newContext();
  let page = await context.newPage();

  try {
    const briefAUrl = await createBrief(page, "共享来源 Brief A", "Brief A：寻找本地工具保留证据链的明确需求。");
    const briefBUrl = await createBrief(page, "共享来源 Brief B", "Brief B：只收集可检查的竞争信号。");
    const briefAId = briefIdFrom(briefAUrl);
    const briefBId = briefIdFrom(briefBUrl);

    await page.goto(briefAUrl);
    await page.getByLabel("公开 RSS/Atom URL").fill(`${feed.url}/feed`);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.locator(".source-notice")).toHaveText("本次新增 1 份来源内容");

    await page.goto(briefBUrl);
    const savedSource = page.locator("article.available-source").filter({
      has: page.getByRole("heading", { name: "Radar Fixture Feed", exact: true }),
    });
    await expect(savedSource.getByText("1 份已取得来源内容 · 1 个 Brief 使用")).toBeVisible();
    await savedSource.getByRole("button", { name: /^使用已保存来源 Radar Fixture Feed/ }).click();
    await expect(page.locator(".source-notice")).toHaveText(
      "已从本地实例复用 Radar Fixture Feed 和 1 份来源内容；没有重新取得内容。",
    );
    await expect(page.locator("article.source-row").getByText("2 个 Brief 使用")).toBeVisible();
    await expect(page.getByRole("link", { name: "Local-first tools gain traction" })).toBeVisible();

    // 同一份来源内容进入两个 Brief 的待判断队列，身份完全相同。
    const pendingA = await readJudgments(page.request, briefAId);
    const pendingB = await readJudgments(page.request, briefBId);
    expect(pendingA.pendingContents).toHaveLength(1);
    expect(pendingB.pendingContents).toHaveLength(1);
    const sharedContentId = pendingA.pendingContents[0].id;
    expect(pendingB.pendingContents[0].id).toBe(sharedContentId);
    expect(pendingA.judgments).toHaveLength(0);
    expect(pendingB.judgments).toHaveLength(0);

    // 每个 Brief 的 Agent 各自写回一次判定。
    await recordJudgment(page.request, briefAId, {
      sourceContentId: sharedContentId,
      relevant: true,
      reason: "A 关心的本地证据需求，作者明说要能自己保管。",
    });
    await recordJudgment(page.request, briefBId, {
      sourceContentId: sharedContentId,
      relevant: false,
      reason: "这份内容不符合 Brief B 的竞争信号边界。",
    });

    const judgedA = await readJudgments(page.request, briefAId);
    expect(judgedA.pendingContents).toHaveLength(0);
    expect(judgedA.judgments).toHaveLength(1);
    expect(judgedA.judgments[0].relevant).toBe(true);
    expect(judgedA.judgments[0].reason).toBe("A 关心的本地证据需求，作者明说要能自己保管。");
    expect(judgedA.judgments[0].signals.map((signal) => signal.sourceContentId)).toEqual([sharedContentId]);

    const judgedB = await readJudgments(page.request, briefBId);
    expect(judgedB.pendingContents).toHaveLength(0);
    expect(judgedB.judgments).toHaveLength(1);
    expect(judgedB.judgments[0].relevant).toBe(false);
    expect(judgedB.judgments[0].reason).toBe("这份内容不符合 Brief B 的竞争信号边界。");
    expect(judgedB.judgments[0].signals).toHaveLength(0);
    expect(judgedB.judgments[0].id).not.toBe(judgedA.judgments[0].id);

    // 一个 Brief 的判断永远不会出现在另一个 Brief 里。
    expect(judgedB.judgments.map((judgment) => judgment.reason)).not.toContain(
      "A 关心的本地证据需求，作者明说要能自己保管。",
    );

    // 判断只能写回自己队列里的来源内容。
    const foreign = await page.request.post(`/api/briefs/${briefBId}/judgments`, {
      data: { sourceContentId: "not-a-known-content", relevant: true, reason: "越界写入" },
    });
    expect(foreign.status()).toBe(400);
    expect(((await foreign.json()) as { error: string }).error).toBe(
      "这份来源内容不在这个 Radar Brief 的待判断队列里。",
    );

    // 新采集的来源内容同时进入两个队列，已有判断保持不变。
    feed.publishChangedEntry();
    await page.goto(briefAUrl);
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.locator(".source-notice")).toHaveText("本次新增 1 份来源内容");
    const refreshedA = await readJudgments(page.request, briefAId);
    const refreshedB = await readJudgments(page.request, briefBId);
    expect(refreshedA.pendingContents).toHaveLength(1);
    expect(refreshedB.pendingContents).toHaveLength(1);
    expect(refreshedA.pendingContents[0].id).toBe(refreshedB.pendingContents[0].id);
    expect(refreshedA.judgments).toHaveLength(1);
    expect(refreshedB.judgments).toHaveLength(1);

    await context.close();
    await stopRadar(radar);
    radar = await startRadar(dataDirectory);
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(briefAUrl);
    await expect(page.getByRole("heading", { name: "共享来源 Brief A" })).toBeVisible();
    const restoredA = await readJudgments(page.request, briefAId);
    const restoredB = await readJudgments(page.request, briefBId);
    expect(restoredA.judgments[0].reason).toBe("A 关心的本地证据需求，作者明说要能自己保管。");
    expect(restoredB.judgments[0].reason).toBe("这份内容不符合 Brief B 的竞争信号边界。");
    await expect(page.locator("article.source-row").getByText("2 个 Brief 使用")).toBeVisible();
  } finally {
    await context.close().catch(() => undefined);
    await stopRadar(radar).catch(() => undefined);
    await feed.close().catch(() => undefined);
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

async function createBrief(page: Page, name: string, description: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Brief 名称").fill(name);
  await page.getByLabel("Radar Brief").fill(description);
  await page.getByRole("button", { name: "创建 Radar Brief" }).click();
  await expect(page.getByText(`${name} 已保存到本地。`)).toBeVisible();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return page.url();
}

function briefIdFrom(briefUrl: string): string {
  return new URL(briefUrl).pathname.split("/").at(-1)!;
}

async function readJudgments(request: APIRequestContext, briefId: string): Promise<JudgmentsView> {
  const response = await request.get(`/api/briefs/${briefId}/judgments`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as JudgmentsView;
}

async function recordJudgment(
  request: APIRequestContext,
  briefId: string,
  body: { sourceContentId: string; relevant: boolean; reason: string },
): Promise<void> {
  const response = await request.post(`/api/briefs/${briefId}/judgments`, { data: body });
  expect(response.status(), await response.text()).toBe(201);
}
