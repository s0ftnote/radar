import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { startFeedFixture, type FeedFixture } from "./support/feed-fixture.js";
import { startRadar, stopRadar, type RunningRadar } from "./support/radar-process.js";

/**
 * 验收打的是 `radar up` 起来的那个服务端——Web 上只剩一张来源页（ADR 0013），
 * 领域行为全部经由 CLI 将要连的那条内部 HTTP 面（ADR 0012）。
 */

type BriefSource = {
  id: string;
  name: string;
  healthStatus: "healthy" | "unhealthy";
  usedByBriefCount: number;
  contents: Array<{ id: string; title: string; originUrl: string }>;
};

type JudgmentsView = {
  pendingContents: Array<{ id: string; title: string; body: string; sourceName: string }>;
  judgments: Array<{
    id: string;
    briefRevisionId: string;
    sourceContentId: string;
    relevant: boolean;
    reason: string;
    signals: Array<{ sourceContentId: string; sourceName: string; title: string }>;
  }>;
};

test.setTimeout(90_000);

async function createBrief(request: APIRequestContext, name: string, description: string) {
  const response = await request.post("/briefs", { data: { name, description } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function linkFeed(request: APIRequestContext, briefId: string, url: string) {
  const response = await request.post(`/briefs/${briefId}/sources`, { data: { url } });
  expect(response.status()).toBe(201);
  return (await response.json()) as BriefSource;
}

async function collect(request: APIRequestContext, briefId: string, sourceId: string) {
  const response = await request.post(`/briefs/${briefId}/sources/${sourceId}/collect`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { newContentCount: number; reusedContentCount: number };
}

async function judgments(request: APIRequestContext, briefId: string) {
  const response = await request.get(`/briefs/${briefId}/judgments`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as JudgmentsView;
}

test("干净实例跑通 Brief → 来源 → 采集 → 判断，并在重启后原样保留", async ({ request }) => {
  let dataDirectory: string | null = null;
  let feed: FeedFixture | null = null;
  let radar: RunningRadar | null = null;

  try {
    dataDirectory = await mkdtemp(join(tmpdir(), "radar-service-"));
    feed = await startFeedFixture();
    radar = await startRadar(dataDirectory);

    const brief = await createBrief(
      request,
      "Walking Skeleton 验收",
      "寻找需要本地保管、逐层追溯并离线交付证据的明确需求。",
    );

    const source = await linkFeed(request, brief.id, `${feed.url}/feed`);
    expect(source.name).toBe("Radar Fixture Feed");
    expect(source.healthStatus).toBe("healthy");
    expect(source.contents).toHaveLength(0);

    const collected = await collect(request, brief.id, source.id);
    expect(collected.newContentCount).toBe(1);
    expect(collected.reusedContentCount).toBe(0);

    const queued = await judgments(request, brief.id);
    expect(queued.pendingContents).toHaveLength(1);
    expect(queued.pendingContents[0].title).toBe("Local-first tools gain traction");
    expect(queued.judgments).toHaveLength(0);

    const pending = queued.pendingContents[0];
    const written = await request.post(`/briefs/${brief.id}/judgments`, {
      data: {
        sourceContentId: pending.id,
        relevant: true,
        reason: "开发者要的是自己留得住的证据，与这条 Brief 的关注目标一致。",
        signalContentIds: [pending.id],
      },
    });
    expect(written.status()).toBe(201);

    const judged = await judgments(request, brief.id);
    expect(judged.pendingContents).toHaveLength(0);
    expect(judged.judgments).toHaveLength(1);
    expect(judged.judgments[0].relevant).toBe(true);
    expect(judged.judgments[0].signals).toHaveLength(1);
    expect(judged.judgments[0].signals[0].sourceName).toBe("Radar Fixture Feed");
    const judgmentId = judged.judgments[0].id;

    // 重启：判断是本地实例的资产，进程走了它得还在。
    await stopRadar(radar);
    radar = await startRadar(dataDirectory);

    const afterRestart = await judgments(request, brief.id);
    expect(afterRestart.judgments).toHaveLength(1);
    expect(afterRestart.judgments[0].id).toBe(judgmentId);
    expect(afterRestart.pendingContents).toHaveLength(0);
  } finally {
    if (radar) await stopRadar(radar);
    if (feed) await feed.close();
    if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("两个 Brief 共享同一份来源内容，判断彼此隔离", async ({ request }) => {
  let dataDirectory: string | null = null;
  let feed: FeedFixture | null = null;
  let radar: RunningRadar | null = null;

  try {
    dataDirectory = await mkdtemp(join(tmpdir(), "radar-isolation-"));
    feed = await startFeedFixture();
    radar = await startRadar(dataDirectory);

    const briefA = await createBrief(
      request,
      "共享来源 Brief A",
      "关注本地优先工具在开发者中的真实呼声与未被满足的部分。",
    );
    const briefB = await createBrief(
      request,
      "共享来源 Brief B",
      "关注证据可追溯这件事在产品决策里被怎样讨论与取舍。",
    );

    const sourceA = await linkFeed(request, briefA.id, `${feed.url}/feed`);
    await collect(request, briefA.id, sourceA.id);

    // B 直接接已保存来源：同一个采集端点，不必重新验证 URL。
    const linkedB = await request.post(`/briefs/${briefB.id}/sources`, {
      data: { sourceId: sourceA.id },
    });
    expect(linkedB.status()).toBe(201);
    const sourceB = (await linkedB.json()) as BriefSource;
    expect(sourceB.usedByBriefCount).toBe(2);

    const queuedA = await judgments(request, briefA.id);
    const queuedB = await judgments(request, briefB.id);
    expect(queuedA.pendingContents).toHaveLength(1);
    expect(queuedB.pendingContents).toHaveLength(1);
    // 同一份来源内容进了两个队列，各自独立判断。
    expect(queuedB.pendingContents[0].id).toBe(queuedA.pendingContents[0].id);

    const written = await request.post(`/briefs/${briefA.id}/judgments`, {
      data: {
        sourceContentId: queuedA.pendingContents[0].id,
        relevant: true,
        reason: "A 关注的正是这类呼声。",
      },
    });
    expect(written.status()).toBe(201);

    const afterA = await judgments(request, briefA.id);
    const afterB = await judgments(request, briefB.id);
    expect(afterA.pendingContents).toHaveLength(0);
    expect(afterA.judgments).toHaveLength(1);
    // B 完全看不见 A 的判断，这条内容在 B 里还等着判。
    expect(afterB.judgments).toHaveLength(0);
    expect(afterB.pendingContents).toHaveLength(1);
  } finally {
    if (radar) await stopRadar(radar);
    if (feed) await feed.close();
    if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("来源验证拒绝坏 feed，重复采集复用已有来源内容", async ({ request }) => {
  let dataDirectory: string | null = null;
  let feed: FeedFixture | null = null;
  let radar: RunningRadar | null = null;

  try {
    dataDirectory = await mkdtemp(join(tmpdir(), "radar-sources-"));
    feed = await startFeedFixture();
    radar = await startRadar(dataDirectory);

    const brief = await createBrief(
      request,
      "来源能力观察",
      "观察公开 RSS 来源的验证、采集与去重在本地实例上的实际表现。",
    );

    const broken = await request.post(`/briefs/${brief.id}/sources`, {
      data: { url: `${feed.url}/broken` },
    });
    expect(broken.status()).toBe(400);

    // 合法但没有条目的 feed 是成功，不是失败。
    const empty = await linkFeed(request, brief.id, `${feed.url}/empty`);
    expect(empty.name).toBe("Empty Radar Fixture Feed");
    const emptyRun = await collect(request, brief.id, empty.id);
    expect(emptyRun.newContentCount).toBe(0);
    expect(emptyRun.reusedContentCount).toBe(0);

    // 没有 guid 与 link 的条目也要各自保持身份。
    const fallback = await linkFeed(request, brief.id, `${feed.url}/fallback`);
    const firstRun = await collect(request, brief.id, fallback.id);
    expect(firstRun.newContentCount).toBe(2);

    const secondRun = await collect(request, brief.id, fallback.id);
    expect(secondRun.newContentCount).toBe(0);
    expect(secondRun.reusedContentCount).toBe(2);

    // 停用之后已取得的来源内容照样留着（ADR 0010：只排序不丢弃）。
    const stopped = await request.delete(`/briefs/${brief.id}/sources/${fallback.id}`);
    expect(stopped.ok()).toBeTruthy();
    const stillQueued = await judgments(request, brief.id);
    expect(stillQueued.pendingContents.length).toBeGreaterThanOrEqual(2);
  } finally {
    if (radar) await stopRadar(radar);
    if (feed) await feed.close();
    if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
  }
});
