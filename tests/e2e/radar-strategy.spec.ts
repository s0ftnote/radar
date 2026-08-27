import { expect, test } from "@playwright/test";
import { createBriefWithAllSources, startHarness, waitForFirstCollection, type Endpoint } from "./support/harness.js";
import { radar, radarJson } from "./support/radar-process.js";

/**
 * 排队策略：Agent 读懂 Brief 之后写下一份打分公式下发给 Radar，Radar 逐条
 * 算分排序、记账哪些端点与信号真的命中了。Radar 全程不理解内容。
 */

type Brief = { id: string; currentRevision: { number: number } };
type Strategy = {
  id: string;
  revisionNumber: number;
  rationale: string;
  authoredBy: string;
  formula: { keywords: Array<{ term: string; weight: number }>; endpointWeights: Record<string, number> };
};
type WorkPackage = {
  pendingContents: Array<{ endpointId: string; title: string; queueEntryId: string; sourceContentId: string }>;
  queueDepth: number;
};
type Stats = {
  strategy: { id: string; revisionNumber: number } | null;
  signals: Array<{ strategyId: string; signal: string; scored: number; judged: number; relevant: number }>;
  endpoints: Array<{ endpointId: string; queued: number; judged: number; relevant: number }>;
};

const briefBody = "关注开发者反复表达、正在变化、可能还没被满足的需求与痛点。";

test.describe("排队策略", () => {
  test.describe.configure({ mode: "serial" });

  test("策略是独立对象、独立版本化，改它不动 Brief", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("strategy", 33181);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await createBriefWithAllSources<Brief>(environment, "Demand Radar", briefBody);
      // 没下发过就是没有，不是一份藏起来的默认值。
      expect(await radarJson(environment, ["strategy", "show", "--brief", brief.id])).toBeNull();

      const first = await radarJson<Strategy>(
        environment,
        ["strategy", "set", "--brief", brief.id, "--rationale", "先按新鲜度来", "--by", "claude-code"],
        JSON.stringify({ freshnessHalfLifeHours: 12, freshnessWeight: 1 }),
      );
      expect(first.revisionNumber).toBe(1);
      expect(first.authoredBy).toBe("claude-code");

      const second = await radarJson<Strategy>(
        environment,
        ["strategy", "set", "--brief", brief.id, "--rationale", "本地优先那类多给一点", "--by", "claude-code"],
        JSON.stringify({
          freshnessHalfLifeHours: 12,
          freshnessWeight: 1,
          keywords: [{ term: "本地优先", weight: 5 }],
        }),
      );
      expect(second.revisionNumber).toBe(2);

      // 修订可追溯：旧版本一并留着，永不改写。
      const revisions = await radarJson<Strategy[]>(
        environment, ["strategy", "revisions", "--brief", brief.id],
      );
      expect(revisions.map((revision) => revision.revisionNumber)).toEqual([2, 1]);
      expect(revisions[1]!.rationale).toBe("先按新鲜度来");
      expect(revisions[1]!.formula.keywords).toEqual([]);

      // Agent 改策略不构成隐式偏好漂移：Brief 还停在用户留下的那一版。
      const unchanged = await radarJson<Brief>(environment, ["brief", "show", brief.id]);
      expect(unchanged.currentRevision.number).toBe(1);

      // 依据与作者都必填——策略修订要有依据可查。
      const noRationale = await radar(
        environment,
        ["strategy", "set", "--brief", brief.id, "--by", "claude-code"],
        JSON.stringify({}),
      );
      expect(noRationale.code).toBe(1);
      expect(noRationale.stderr).toContain("--rationale");
    } finally {
      await harness.dispose();
    }
  });

  test("关键词与端点权重真的改变顺序，但从不排除任何内容", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("strategy-order", 33182);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await createBriefWithAllSources<Brief>(environment, "Demand Radar", briefBody);

      // 默认公式是纯新鲜度，alpha 两条都比 beta 新。分数说了算，所以两条
      // alpha 在前——但 beta 照样占得到它那条保底名额（ADR 0010：配额约束的是
      // 「每个端点至少占几条」，不是把名额均分）。
      const before = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(before.pendingContents.map((content) => content.endpointId)).toEqual([
        "fixture-alpha", "fixture-alpha", "fixture-beta",
      ]);

      // 名额不够时保底照样兑现：只要两条，最高分那条 + beta 的保底那条。
      const capped = await radarJson<WorkPackage>(
        environment, ["pending", "--brief", brief.id, "--limit", "2"],
      );
      expect(capped.pendingContents.map((content) => content.endpointId)).toEqual([
        "fixture-alpha", "fixture-beta",
      ]);

      // beta 那条正文里有「本地优先」；给它一个压过新鲜度的权重。
      await radarJson(
        environment,
        ["strategy", "set", "--brief", brief.id, "--rationale", "本地优先的讨论优先", "--by", "claude-code"],
        JSON.stringify({
          freshnessHalfLifeHours: 24,
          freshnessWeight: 1,
          keywords: [{ term: "本地优先", weight: 100 }],
        }),
      );

      const after = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(after.pendingContents[0]!.endpointId).toBe("fixture-beta");
      // 一条都没少：只排序不丢弃（ADR 0010）。
      expect(after.pendingContents).toHaveLength(before.pendingContents.length);
      expect(after.queueDepth).toBe(before.queueDepth);
      expect(new Set(after.pendingContents.map((c) => c.sourceContentId))).toEqual(
        new Set(before.pendingContents.map((c) => c.sourceContentId)),
      );

      // 减分也只是减分：招聘帖沉到最后，但还在。
      await radarJson(
        environment,
        ["strategy", "set", "--brief", brief.id, "--rationale", "招聘帖沉底", "--by", "claude-code"],
        JSON.stringify({
          freshnessHalfLifeHours: 24,
          freshnessWeight: 1,
          keywords: [{ term: "招聘", weight: -100 }],
        }),
      );
      const demoted = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(demoted.pendingContents.map((content) => content.title)).toContain(
        "招聘帖：我们在招后端",
      );

      // 端点权重同理：它是加分，不是开关。
      await radarJson(
        environment,
        ["strategy", "set", "--brief", brief.id, "--rationale", "beta 更值得看", "--by", "claude-code"],
        JSON.stringify({
          freshnessHalfLifeHours: 24,
          freshnessWeight: 1,
          endpointWeights: { "fixture-beta": 100 },
        }),
      );
      const weighted = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(weighted.pendingContents[0]!.endpointId).toBe("fixture-beta");
      expect(weighted.pendingContents).toHaveLength(3);
    } finally {
      await harness.dispose();
    }
  });

  test("关键词不能用于排除，Radar 明确拒绝", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("strategy-exclude", 33183);
    const { environment } = harness;
    try {
      const brief = await createBriefWithAllSources<Brief>(environment, "Demand Radar", briefBody);
      const refused = await radar(
        environment,
        ["strategy", "set", "--brief", brief.id, "--rationale", "想把招聘帖直接扔掉", "--by", "claude-code"],
        JSON.stringify({ keywords: [{ term: "招聘", weight: 0, exclude: true }] }),
      );
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("不能用于排除");
    } finally {
      await harness.dispose();
    }
  });

  test("每个端点与每条信号都留下命中统计，纯计数", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("strategy-stats", 33184);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await createBriefWithAllSources<Brief>(environment, "Demand Radar", briefBody);
      await radarJson(
        environment,
        ["strategy", "set", "--brief", brief.id, "--rationale", "本地优先优先", "--by", "claude-code"],
        JSON.stringify({
          freshnessHalfLifeHours: 24,
          freshnessWeight: 1,
          keywords: [{ term: "本地优先", weight: 10 }],
        }),
      );

      const workPackage = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      const keywordHit = workPackage.pendingContents.find((content) =>
        content.title.includes("本地优先"),
      )!;

      const beforeJudging = await radarJson<Stats>(
        environment, ["strategy", "stats", "--brief", brief.id],
      );
      expect(beforeJudging.strategy!.revisionNumber).toBe(1);
      const keywordSignal = beforeJudging.signals.find(
        (signal) => signal.signal === "keyword:本地优先",
      )!;
      expect(keywordSignal.strategyId).toBe(beforeJudging.strategy!.id);
      expect(keywordSignal.scored).toBe(1);
      expect(keywordSignal.judged).toBe(0);
      expect(beforeJudging.signals.find((signal) => signal.signal === "freshness")!.scored).toBe(3);
      expect(beforeJudging.endpoints.map((row) => row.endpointId)).toEqual([
        "fixture-alpha", "fixture-beta",
      ]);
      expect(beforeJudging.endpoints.every((row) => row.judged === 0)).toBe(true);

      await radarJson(
        environment,
        ["judge"],
        JSON.stringify({
          queueEntryId: keywordHit.queueEntryId,
          relevant: true,
          whatItIs: "一条关于本地优先取舍的讨论。",
          evidence: "帖子里在比同步与所有权。",
          uncertainty: "不知道这是不是普遍关切。",
          whyForYou: "正是这条 Brief 关注的痛点。",
          judgedBy: "claude-code",
          signalContentIds: [keywordHit.sourceContentId],
        }),
      );

      // 判完之后统计跟上：策略修订有依据可查。
      const after = await radarJson<Stats>(environment, ["strategy", "stats", "--brief", brief.id]);
      const judgedSignal = after.signals.find((signal) => signal.signal === "keyword:本地优先")!;
      expect(judgedSignal.judged).toBe(1);
      expect(judgedSignal.relevant).toBe(1);
      const beta = after.endpoints.find((row) => row.endpointId === "fixture-beta")!;
      expect(beta.judged).toBe(1);
      expect(beta.relevant).toBe(1);
      expect(after.endpoints.find((row) => row.endpointId === "fixture-alpha")!.judged).toBe(0);
    } finally {
      await harness.dispose();
    }
  });

  test("还没下发过公式那段时间也留下依据——Agent 写第一版公式靠的就是它", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("strategy-default", 33186);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await createBriefWithAllSources<Brief>(environment, "Demand Radar", briefBody);
      await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);

      const stats = await radarJson<Stats>(environment, ["strategy", "stats", "--brief", brief.id]);
      expect(stats.strategy).toBeNull();
      const freshness = stats.signals.find((signal) => signal.signal === "freshness")!;
      expect(freshness.strategyId).toBe("default");
      expect(freshness.scored).toBe(3);

      // 下发第一版之后，两段依据各归各的，不混成一个总数。
      await radarJson(
        environment,
        ["strategy", "set", "--brief", brief.id, "--rationale", "第一版", "--by", "claude-code"],
        JSON.stringify({ freshnessHalfLifeHours: 24, freshnessWeight: 1 }),
      );
      await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);

      const split = await radarJson<Stats>(environment, ["strategy", "stats", "--brief", brief.id]);
      const buckets = split.signals.filter((signal) => signal.signal === "freshness");
      expect(buckets).toHaveLength(2);
      expect(new Set(buckets.map((bucket) => bucket.strategyId))).toEqual(
        new Set(["default", split.strategy!.id]),
      );
    } finally {
      await harness.dispose();
    }
  });

  test("队列再长也不先按新鲜度砍一刀：沉得很深的老内容照样浮得上来", async () => {
    test.setTimeout(180_000);
    const harness = await startHarness("strategy-deep", 33187);
    const { environment, feed } = harness;
    try {
      await waitForFirstCollection(environment);

      // alpha 换成一整页 250 条，那条要找的埋在最后——比任何按新鲜度取头部的
      // 候选窗口都深。
      feed.replacePage("/alpha", [
        ...Array.from({ length: 249 }, (_unused, index) => ({
          guid: `bulk-${index}`,
          title: `例行内容 ${index}`,
          body: "跟关注目标没什么关系的一条。",
          publishedAt: new Date(Date.UTC(2026, 7, 25, 0, 0, 0) - index * 60_000).toUTCString(),
        })),
        {
          guid: "buried",
          title: "埋在最底下的那条",
          body: "这条正文里有「反复出现的痛点」这几个字。",
          publishedAt: "Mon, 01 Jan 2024 00:00:00 GMT",
        },
      ]);
      await radarJson(environment, ["collect", "--endpoint", "fixture-alpha"]);

      const brief = await createBriefWithAllSources<Brief>(environment, "Demand Radar", briefBody);
      await radarJson(
        environment,
        ["strategy", "set", "--brief", brief.id, "--rationale", "只认这个词", "--by", "claude-code"],
        JSON.stringify({
          freshnessHalfLifeHours: 24,
          freshnessWeight: 0,
          keywords: [{ term: "反复出现的痛点", weight: 100 }],
        }),
      );

      const ordered = await radarJson<WorkPackage>(
        environment, ["pending", "--brief", brief.id, "--limit", "5"],
      );
      expect(ordered.pendingContents[0]!.title).toBe("埋在最底下的那条");
    } finally {
      await harness.dispose();
    }
  });

  test("平台自带热度只有平台给了才有，Radar 只当它是一个数", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("strategy-hotness", 33185);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const endpoint = await radarJson<Endpoint>(environment, [
        "sources", "add", "--channel", "agent-push",
        "--name", "某个板块", "--url", "https://example.invalid/r/hot",
      ]);
      const brief = await createBriefWithAllSources<Brief>(environment, "Demand Radar", briefBody);

      await radarJson(
        environment,
        ["push", "--endpoint", endpoint.id],
        JSON.stringify([
          {
            externalId: "cold",
            title: "没什么人理的一条",
            originUrl: "https://example.invalid/cold",
            body: "内容本身没问题。",
            publishedAt: "2026-08-25T06:00:00.000Z",
            hotness: 1,
          },
          {
            externalId: "hot",
            title: "炸了的那一条",
            originUrl: "https://example.invalid/hot",
            body: "内容本身也没问题。",
            publishedAt: "2026-08-25T05:00:00.000Z",
            hotness: 900,
          },
        ]),
      );

      await radarJson(
        environment,
        ["strategy", "set", "--brief", brief.id, "--rationale", "热度说了算", "--by", "claude-code"],
        JSON.stringify({ freshnessHalfLifeHours: 24, freshnessWeight: 1, hotnessWeight: 0.01 }),
      );

      const ordered = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      const mine = ordered.pendingContents.filter((content) => content.endpointId === endpoint.id);
      // 更旧但更热的排在前面——热度确实进了分数。
      expect(mine[0]!.title).toBe("炸了的那一条");
    } finally {
      await harness.dispose();
    }
  });
});
