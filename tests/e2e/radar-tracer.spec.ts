import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startFeedFixture, type FeedFixture } from "./support/feed-fixture.js";
import {
  delay,
  radar,
  radarJson,
  startRadar,
  stopRadar,
  type RadarEnvironment,
  type RunningRadar,
} from "./support/radar-process.js";

/**
 * 第一颗 tracer bullet：出厂端点自采 → 判断 → 反馈回到下一个工作包。
 * 终点是**反馈**不是判断——只做到判断只能证明聚合器成立。
 */

type Brief = { id: string; name: string; currentRevision: { id: string; number: number; body: string } };

type Endpoint = {
  id: string;
  name: string;
  url: string;
  provenance: "factory" | "user";
  licenseBasis: { basis: string; reference: string } | null;
  status: string;
  consecutiveFailures: number;
  retryAfter: string | null;
  userDisabledAt: string | null;
  retiredAt: string | null;
};

type WorkPackage = {
  brief: { id: string; name: string; revision: { id: string; number: number; body: string } };
  feedback: Array<{ id: string; judgmentId: string | null; disposition: string; note: string }>;
  recentJudgments: Array<{ id: string; title: string; relevant: boolean }>;
  pendingContents: Array<{
    queueEntryId: string;
    sourceContentId: string;
    endpointId: string;
    title: string;
    body: string;
  }>;
  queueDepth: number;
};

type Judgment = {
  id: string;
  relevant: boolean;
  whatItIs: string;
  evidence: string;
  uncertainty: string;
  whyForYou: string;
  judgedBy: string;
  signals: Array<{ sourceContentId: string; title: string }>;
};

const briefBody =
  "关注开发者反复表达、正在变化、可能还没被满足的需求与痛点。招聘、活动通知不算。";

async function fixtureCatalog(
  directory: string,
  feed: FeedFixture,
  collectionIntervalSeconds = 900,
): Promise<string> {
  const path = join(directory, "catalog.json");
  await writeFile(
    path,
    JSON.stringify({
      catalogVersion: 1,
      channels: [
        { id: "rss", name: "RSS / Atom", configState: "ready", collectionIntervalSeconds },
      ],
      endpoints: [
        {
          id: "fixture-alpha",
          channelId: "rss",
          name: "Fixture Alpha",
          url: `${feed.url}/alpha`,
          licenseBasis: { basis: "publisher-provided-feed", reference: `${feed.url}/terms` },
        },
        {
          id: "fixture-beta",
          channelId: "rss",
          name: "Fixture Beta",
          url: `${feed.url}/beta`,
          licenseBasis: { basis: "publisher-provided-feed", reference: `${feed.url}/terms` },
        },
      ],
    }),
  );
  return path;
}

type Harness = {
  environment: RadarEnvironment;
  feed: FeedFixture;
  radarProcess: RunningRadar;
  dispose(): Promise<void>;
};

async function startHarness(
  label: string,
  port: number,
  collectionIntervalSeconds?: number,
): Promise<Harness> {
  const dataDirectory = await mkdtemp(join(tmpdir(), `radar-${label}-`));
  const feed = await startFeedFixture();
  const catalogPath = await fixtureCatalog(dataDirectory, feed, collectionIntervalSeconds);
  const environment = { dataDirectory, catalogPath };
  const radarProcess = await startRadar(dataDirectory, { port, catalogPath });
  return {
    environment,
    feed,
    radarProcess,
    dispose: async () => {
      await stopRadar(radarProcess);
      await feed.close();
      await rm(dataDirectory, { recursive: true, force: true });
    },
  };
}

/** 等首采落地：服务起来立刻首采，端点见过内容就算到位。 */
async function waitForFirstCollection(environment: RadarEnvironment): Promise<Endpoint[]> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const endpoints = await radarJson<Endpoint[]>(environment, ["sources"]);
    if (endpoints.every((endpoint) => endpoint.status !== "recently_failed")) {
      const runs = endpoints.filter((endpoint) => endpoint.id.startsWith("fixture-"));
      if (runs.length === 2) return endpoints;
    }
    await delay(100);
  }
  throw new Error("等首采超时。");
}

test.describe("tracer bullet", () => {
  test.describe.configure({ mode: "serial" });

  test("反馈写回之后，下一个工作包原样带回那条反馈", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("tracer", 33151);
    const { environment, feed } = harness;
    try {
      await waitForFirstCollection(environment);

      // 出厂目录是仓库里的数据文件，每条端点带永不复用的稳定 id、provenance
      // 与机器可读的许可依据。
      const endpoints = await radarJson<Endpoint[]>(environment, ["sources"]);
      expect(endpoints.map((endpoint) => endpoint.id)).toEqual(["fixture-alpha", "fixture-beta"]);
      expect(endpoints.every((endpoint) => endpoint.provenance === "factory")).toBe(true);
      expect(endpoints[0]!.licenseBasis?.basis).toBe("publisher-provided-feed");

      const brief = await radarJson<Brief>(
        environment,
        ["brief", "create", "--name", "Demand Radar"],
        briefBody,
      );
      expect(brief.currentRevision.number).toBe(1);

      // 建完 Brief 立刻看得见各端点当前那一页。
      const first = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(first.brief.revision.body).toBe(briefBody);
      expect(first.feedback).toEqual([]);
      expect(first.pendingContents).toHaveLength(3);
      expect(first.queueDepth).toBe(3);

      // 默认排序是纯新鲜度 + 一层确定性端点轮转。纯新鲜度会给出
      // [alpha, alpha, beta]——轮转把 beta 提到第二位，这才证明轮转真的生效。
      expect(first.pendingContents.map((content) => content.endpointId)).toEqual([
        "fixture-alpha",
        "fixture-beta",
        "fixture-alpha",
      ]);

      // --limit 封顶只影响这一包给多少，不改变队列本身有多深。
      const capped = await radarJson<WorkPackage>(environment, [
        "pending",
        "--brief",
        brief.id,
        "--limit",
        "2",
      ]);
      expect(capped.pendingContents).toHaveLength(2);
      expect(capped.queueDepth).toBe(3);

      const target = first.pendingContents.find((content) =>
        content.title.includes("证据留不住"),
      )!;
      const judgment = await radarJson<Judgment>(
        environment,
        ["judge"],
        JSON.stringify({
          queueEntryId: target.queueEntryId,
          relevant: true,
          whatItIs: "一条关于证据可追溯的抱怨。",
          evidence: "原帖说删帖之后引用就断了。",
          uncertainty: "不知道这是普遍现象还是个例。",
          whyForYou: "这正是这条 Brief 关注的、反复出现又没被满足的痛点。",
          judgedBy: "claude-code",
          signalContentIds: [target.sourceContentId],
        }),
      );
      // ADR 0015：入队的是采集当时的正文快照，不是一个回原站的指针。
      expect(target.body).toBe("帖子里反复出现同一个诉求：删帖之后引用就断了。");

      expect(judgment.relevant).toBe(true);
      expect(judgment.judgedBy).toBe("claude-code");
      expect(judgment.signals).toHaveLength(1);

      // 用户随口一句「这类以后别给我」。
      const written = await radarJson<{ id: string; judgmentId: string | null }>(
        environment,
        ["feedback", "--brief", brief.id, "--judgment", judgment.id, "--disposition", "少给这类"],
        "招聘帖一律不要，我要的是痛点不是岗位。",
      );
      expect(written.judgmentId).toBe(judgment.id);

      // 闭环：下一次取工作包，那句话原样回来了。
      const second = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(second.feedback).toHaveLength(1);
      expect(second.feedback[0]!.note).toBe("招聘帖一律不要，我要的是痛点不是岗位。");
      expect(second.feedback[0]!.disposition).toBe("少给这类");
      expect(second.feedback[0]!.judgmentId).toBe(judgment.id);

      // 判过的那条离开队列，最近判断的紧凑清单里认得出它。
      expect(second.pendingContents.map((content) => content.queueEntryId)).not.toContain(
        target.queueEntryId,
      );
      expect(second.queueDepth).toBe(2);
      expect(second.recentJudgments).toEqual([
        { id: judgment.id, title: target.title, relevant: true, createdAt: expect.any(String) },
      ]);

      // 反馈也可以只挂在 Brief 上。
      await radarJson(
        environment,
        ["feedback", "--brief", brief.id, "--disposition", "长期偏好"],
        "以后多给我看跨团队都在说的那种。",
      );
      const third = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(third.feedback).toHaveLength(2);
      expect(third.feedback[1]!.judgmentId).toBeNull();

      // 采集反复跑不改变已判断的事实：同一条 guid 不重复入队。
      feed.editEntry("alpha-1", { title: "开发者抱怨证据留不住（已编辑）" });
      feed.editEntry("beta-1", { body: "上游把这段正文整个换掉了。" });
      await radarJson(environment, ["collect", "--endpoint", "fixture-alpha"]);
      await radarJson(environment, ["collect", "--endpoint", "fixture-beta"]);
      const fourth = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(fourth.queueDepth).toBe(2);
      expect(fourth.pendingContents.map((content) => content.title)).not.toContain(
        "开发者抱怨证据留不住（已编辑）",
      );

      // 快照定在采集当时：上游改了正文，判断依据的那份不跟着变（ADR 0015）。
      const beta = fourth.pendingContents.find(
        (content) => content.endpointId === "fixture-beta",
      )!;
      expect(beta.body).toBe("讨论集中在同步与所有权之间怎么选。");
    } finally {
      await harness.dispose();
    }
  });

  test("队列代次挡下重复写回，幂等键放过同一调用者的重试", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("generation", 33152);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await radarJson<Brief>(
        environment,
        ["brief", "create", "--name", "代次验收"],
        briefBody,
      );
      const work = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      const target = work.pendingContents[0]!;

      const contract = {
        queueEntryId: target.queueEntryId,
        relevant: false,
        whyForYou: "跟这条 Brief 的关注目标无关。",
        judgedBy: "claude-code",
        idempotencyKey: "retry-1",
      };

      const judgment = await radarJson<Judgment>(environment, ["judge"], JSON.stringify(contract));
      expect(judgment.relevant).toBe(false);
      // 判不相关时只写淘汰理由，其余三块留空——理由照样必填。
      expect(judgment.whyForYou).toBe("跟这条 Brief 的关注目标无关。");
      expect([judgment.whatItIs, judgment.evidence, judgment.uncertainty]).toEqual(["", "", ""]);

      // 同一调用者的网络重试：幂等键让它拿回同一条判断，不是一条新的。
      const replayed = await radarJson<Judgment>(environment, ["judge"], JSON.stringify(contract));
      expect(replayed.id).toBe(judgment.id);

      // 另一个调用者拿同一个代次再写一次：代次已经消费掉了，明确拒绝。
      const duplicate = await radar(
        environment,
        ["judge"],
        JSON.stringify({ ...contract, idempotencyKey: undefined }),
      );
      expect(duplicate.code).toBe(1);
      expect(duplicate.stderr).toContain("已经判过了");

      const judgments = await radarJson<Judgment[]>(environment, ["judgments", "--brief", brief.id]);
      expect(judgments).toHaveLength(1);

      // 淘汰理由必填。
      const missingReason = await radar(
        environment,
        ["judge"],
        JSON.stringify({
          queueEntryId: work.pendingContents[1]!.queueEntryId,
          relevant: false,
          whyForYou: "",
          judgedBy: "claude-code",
        }),
      );
      expect(missingReason.code).toBe(1);
      expect(missingReason.stderr).toContain("淘汰理由不能为空");
    } finally {
      await harness.dispose();
    }
  });

  test("连续失败退避，成功后复位，端点永不因失败自动下架", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("backoff", 33153);
    const { environment, feed } = harness;
    try {
      await waitForFirstCollection(environment);

      feed.breakFeed();
      const failed = await radarJson<{ endpointId: string; status: string }>(environment, [
        "collect",
        "--endpoint",
        "fixture-alpha",
      ]);
      expect(failed.status).toBe("failed");

      const afterOne = (await radarJson<Endpoint[]>(environment, ["sources"]))[0]!;
      expect(afterOne.status).toBe("recently_failed");
      expect(afterOne.consecutiveFailures).toBe(1);
      expect(afterOne.retryAfter).not.toBeNull();
      // 失败只导致退避，永不下架：两个停用字段都没被碰。
      expect(afterOne.userDisabledAt).toBeNull();
      expect(afterOne.retiredAt).toBeNull();

      // 退避是真的会拦住下一次例行采集的——只有点名那一条才强行穿过去。
      const sweep = await radarJson<Array<{ endpointId: string; skippedBecause?: string }>>(
        environment,
        ["collect"],
      );
      expect(sweep.find((result) => result.endpointId === "fixture-alpha")).toMatchObject({
        status: "skipped",
        skippedBecause: "backing_off",
      });
      expect((await radarJson<Endpoint[]>(environment, ["sources"]))[0]!.consecutiveFailures).toBe(1);

      await radarJson(environment, ["collect", "--endpoint", "fixture-alpha"]);
      const afterTwo = (await radarJson<Endpoint[]>(environment, ["sources"]))[0]!;
      expect(afterTwo.consecutiveFailures).toBe(2);
      expect(Date.parse(afterTwo.retryAfter!)).toBeGreaterThan(Date.parse(afterOne.retryAfter!));

      feed.restoreFeed();
      await radarJson(environment, ["collect", "--endpoint", "fixture-alpha"]);
      const recovered = (await radarJson<Endpoint[]>(environment, ["sources"]))[0]!;
      expect(recovered.status).toBe("normal");
      expect(recovered.consecutiveFailures).toBe(0);
      expect(recovered.retryAfter).toBeNull();
    } finally {
      await harness.dispose();
    }
  });

  test("Brief 在端点之后创建时只拿当前一页，不回填历史", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("currentpage", 33154);
    const { environment, feed } = harness;
    try {
      await waitForFirstCollection(environment);

      const older = await radarJson<Brief>(
        environment,
        ["brief", "create", "--name", "先建的 Brief"],
        briefBody,
      );
      expect(
        (await radarJson<WorkPackage>(environment, ["pending", "--brief", older.id])).queueDepth,
      ).toBe(3);

      // alpha 换了一整页：原来那两条从 feed 上下架，Radar 库里还留着它们。
      feed.replacePage("/alpha", [
        {
          guid: "alpha-3",
          title: "新一页的头条",
          body: "这条是新出现的。",
          publishedAt: "Tue, 25 Aug 2026 08:00:00 GMT",
        },
      ]);
      await radarJson(environment, ["collect", "--endpoint", "fixture-alpha"]);

      // 先建的 Brief 拿到新增的那条，已经入过队的两条照样留着（ADR 0010：只排序不丢弃）。
      const olderAfter = await radarJson<WorkPackage>(environment, ["pending", "--brief", older.id]);
      expect(olderAfter.queueDepth).toBe(4);
      expect(olderAfter.pendingContents.map((content) => content.title)).toContain("新一页的头条");
      expect(olderAfter.pendingContents.map((content) => content.title)).toContain(
        "招聘帖：我们在招后端",
      );

      // 后建的 Brief 只拿当前一页：alpha 现在只剩一条，beta 一条。
      // 已经从 feed 上下架的两条不回填。
      const newer = await radarJson<Brief>(
        environment,
        ["brief", "create", "--name", "后建的 Brief"],
        briefBody,
      );
      const newerWork = await radarJson<WorkPackage>(environment, ["pending", "--brief", newer.id]);
      expect(newerWork.queueDepth).toBe(2);
      expect(newerWork.pendingContents.map((content) => content.title).sort()).toEqual([
        "新一页的头条",
        "本地优先工具的取舍讨论",
      ].sort());
    } finally {
      await harness.dispose();
    }
  });

  test("单端点防重入：上一次采集没结束时不重复发起", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("reentrancy", 33155);
    const { environment, feed } = harness;
    try {
      await waitForFirstCollection(environment);

      feed.delayNextResponse(1_500);
      const [first, second] = await Promise.all([
        radarJson<{ status: string }>(environment, ["collect", "--endpoint", "fixture-alpha"]),
        (async () => {
          await delay(300);
          return radarJson<{ status: string; skippedBecause?: string }>(environment, [
            "collect",
            "--endpoint",
            "fixture-alpha",
          ]);
        })(),
      ]);

      expect(first.status).toBe("success");
      expect(second.status).toBe("skipped");
      expect(second.skippedBecause).toBe("already_collecting");
    } finally {
      await harness.dispose();
    }
  });

  test("首采之后按渠道级节奏继续定时采集", async () => {
    test.setTimeout(120_000);
    // 渠道节奏调到 1 秒；调度的看一眼间隔跟着最快的渠道走。
    const harness = await startHarness("cadence", 33156, 1);
    const { environment, feed } = harness;
    try {
      await waitForFirstCollection(environment);
      const afterFirst = feed.requestCount("/alpha");
      expect(afterFirst).toBeGreaterThanOrEqual(1);

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && feed.requestCount("/alpha") <= afterFirst) {
        await delay(200);
      }
      // 没有人敲 collect，端点自己又被采了一次。
      expect(feed.requestCount("/alpha")).toBeGreaterThan(afterFirst);
    } finally {
      await harness.dispose();
    }
  });
});
