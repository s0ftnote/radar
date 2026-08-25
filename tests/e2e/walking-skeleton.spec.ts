import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";
import { startFeedFixture, type FeedFixture } from "./support/feed-fixture";
import { startRadar, stopRadar } from "./support/radar-process";

type JudgmentsView = {
  pendingContents: Array<{ id: string; title: string; body: string; sourceName: string }>;
  judgments: Array<{
    id: string;
    briefRevisionId: string;
    sourceContentId: string;
    relevant: boolean;
    reason: string;
    signals: Array<{
      sourceContentId: string;
      sourceId: string;
      sourceName: string;
      title: string;
      originUrl: string;
    }>;
  }>;
};

test.setTimeout(90_000);

test("干净会话可以跑通并重启恢复 Radar walking skeleton", async ({ browser }) => {
  let dataDirectory: string | null = null;
  let feed: FeedFixture | null = null;
  let radar: ChildProcess | null = null;
  let context: BrowserContext | null = null;

  try {
    dataDirectory = await mkdtemp(join(tmpdir(), "radar-walking-skeleton-"));
    feed = await startFeedFixture();
    radar = await startRadar(dataDirectory);
    context = await browser.newContext();
    let page = await context.newPage();
    await page.goto("/");
    await expect(page.getByText("还没有 Radar Brief")).toBeVisible();
    await page.getByLabel("Brief 名称").fill("Walking Skeleton 验收");
    await page.getByLabel("Radar Brief").fill("寻找需要本地保管、逐层追溯并离线交付证据的明确需求。");

    await context.setOffline(true);
    await page.getByRole("button", { name: "创建 Radar Brief" }).click();
    await expect(page.getByText("Radar 暂时无法连接，Radar Brief 没有保存，请重试。")).toBeVisible();
    await context.setOffline(false);

    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 750,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await page.getByRole("button", { name: "创建 Radar Brief" }).click();
    await expect(page.locator(".create-brief form")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByText("正在保存 Radar Brief…")).toBeVisible();
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await page.getByRole("link", { name: /Walking Skeleton 验收/ }).click();
    await expect(page.getByRole("heading", { name: "Walking Skeleton 验收" })).toBeVisible();
    const briefUrl = page.url();
    const briefId = new URL(briefUrl).pathname.split("/").at(-1)!;

    await expect(page.getByText("还没有来源")).toBeVisible();

    feed.delayNextResponse();
    await page.getByLabel("公开 RSS/Atom URL").fill(`${feed.url}/feed`);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await expect(page.getByRole("button", { name: "正在验证…" })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Radar Fixture Feed" })).toBeVisible();

    feed.delayNextResponse();
    await page.getByRole("button", { name: "采集 Radar Fixture Feed" }).click();
    await expect(page.getByRole("button", { name: "正在采集…" })).toBeDisabled();
    await expect(page.locator(".source-notice")).toHaveText("本次新增 1 份来源内容");
    await expect(page.getByRole("link", { name: "Local-first tools gain traction" })).toBeVisible();

    // Radar 自己不判断：待判断队列排给用户自己的 Agent，判断经 Radar Skill 写回。
    const queued = (await (await page.request.get(`/api/briefs/${briefId}/judgments`)).json()) as JudgmentsView;
    expect(queued.pendingContents).toHaveLength(1);
    expect(queued.pendingContents[0].title).toBe("Local-first tools gain traction");
    expect(queued.pendingContents[0].body).toBe("Revision 1: developers want evidence they can keep.");
    expect(queued.pendingContents[0].sourceName).toBe("Radar Fixture Feed");
    expect(queued.judgments).toHaveLength(0);

    const contentId = queued.pendingContents[0].id;
    const written = await page.request.post(`/api/briefs/${briefId}/judgments`, {
      data: {
        sourceContentId: contentId,
        relevant: true,
        reason: "作者明说要能自己保管证据，正是这个 Brief 关注的需求。",
        signalContentIds: [contentId],
      },
    });
    expect(written.status(), await written.text()).toBe(201);

    const judged = (await (await page.request.get(`/api/briefs/${briefId}/judgments`)).json()) as JudgmentsView;
    expect(judged.pendingContents).toHaveLength(0);
    expect(judged.judgments).toHaveLength(1);
    expect(judged.judgments[0].relevant).toBe(true);
    expect(judged.judgments[0].briefRevisionId).toBeTruthy();
    expect(judged.judgments[0].signals).toEqual([
      {
        sourceContentId: contentId,
        sourceId: expect.any(String),
        sourceName: "Radar Fixture Feed",
        title: "Local-first tools gain traction",
        originUrl: "https://example.test/fixture-entry-1",
      },
    ]);

    await context.close();
    context = null;
    await stopRadar(radar);
    radar = null;
    radar = await startRadar(dataDirectory);
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto("/");
    await page.getByRole("link", { name: /Walking Skeleton 验收/ }).click();
    await expect(page).toHaveURL(briefUrl);
    await expect(page.getByRole("heading", { name: "Radar Fixture Feed" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Local-first tools gain traction" })).toBeVisible();

    const restored = (await (await page.request.get(`/api/briefs/${briefId}/judgments`)).json()) as JudgmentsView;
    expect(restored.pendingContents).toHaveLength(0);
    expect(restored.judgments).toHaveLength(1);
    expect(restored.judgments[0].id).toBe(judged.judgments[0].id);
    expect(restored.judgments[0].reason).toBe("作者明说要能自己保管证据，正是这个 Brief 关注的需求。");
    expect(restored.judgments[0].signals[0].sourceContentId).toBe(contentId);
  } finally {
    await context?.close().catch(() => undefined);
    if (radar) await stopRadar(radar).catch(() => undefined);
    await feed?.close().catch(() => undefined);
    if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  }
});
