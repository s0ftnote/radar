import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createBriefWithAllSources, startHarness, waitForFirstCollection, type Endpoint } from "./support/harness.js";
import { radar, radarJson } from "./support/radar-process.js";

/**
 * 配置后解锁渠道：需要登录态的平台 Radar 够不着，由用户自己的 Agent 采完推来
 * （ADR 0011）。Radar 不写登录态适配器、不保管任何登录态。
 */

type Brief = { id: string };
type WorkPackage = {
  pendingContents: Array<{ endpointId: string; title: string; body: string; sourceContentId: string }>;
  queueDepth: number;
};

const briefBody = "关注开发者反复表达、正在变化、可能还没被满足的需求与痛点。";

const pushed = [
  {
    externalId: "t3_abc123",
    title: "某个登录才看得到的板块里的抱怨",
    originUrl: "https://example.invalid/r/somewhere/comments/abc123",
    body: "帖子里说这套流程每次都要手动重来一遍。",
    publishedAt: "2026-08-25T02:00:00.000Z",
  },
];

test.describe("配置后解锁渠道", () => {
  test.describe.configure({ mode: "serial" });

  test("Agent 推来的内容与自采的走同一条路：去重、正文快照、入队", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("push", 33171);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);

      // 端点必须先经管家角色登记，推来的内容才有来源归属。
      const endpoint = await radarJson<Endpoint>(environment, [
        "sources", "add", "--channel", "agent-push",
        "--name", "某个登录才看得到的板块", "--url", "https://example.invalid/r/somewhere",
      ]);
      // 这类端点的来源状态是「等推送」，不是故障。
      expect(endpoint.status).toBe("awaiting_push");
      expect(endpoint.lastPushAt).toBeNull();

      const brief = await createBriefWithAllSources<Brief>(environment, "Demand Radar", briefBody);

      const first = await radarJson<{ newContentCount: number; seenContentCount: number }>(
        environment, ["push", "--endpoint", endpoint.id], JSON.stringify(pushed),
      );
      expect(first).toMatchObject({ status: "success", newContentCount: 1, seenContentCount: 1 });

      const afterPush = (await radarJson<Endpoint[]>(environment, ["sources"])).find(
        (candidate) => candidate.id === endpoint.id,
      )!;
      // 只记最后一次收到推送是什么时候；久未推送不是故障，不进失败计数也不退避。
      expect(afterPush.lastPushAt).not.toBeNull();
      expect(afterPush.status).toBe("awaiting_push");
      expect(afterPush.consecutiveFailures).toBe(0);
      expect(afterPush.retryAfter).toBeNull();

      // 入队与自采无差别：它就在待判断里，带着推来的正文快照（ADR 0015）。
      const workPackage = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      const mine = workPackage.pendingContents.find(
        (content) => content.endpointId === endpoint.id,
      )!;
      expect(mine.title).toBe("某个登录才看得到的板块里的抱怨");
      expect(mine.body).toBe("帖子里说这套流程每次都要手动重来一遍。");

      // 去重也无差别：同一个 externalId 再推一次不新增，正文快照不被改写。
      const again = await radarJson<{ newContentCount: number }>(
        environment,
        ["push", "--endpoint", endpoint.id],
        JSON.stringify([{ ...pushed[0]!, body: "上游把正文改了。" }]),
      );
      expect(again.newContentCount).toBe(0);
      const second = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(second.queueDepth).toBe(workPackage.queueDepth);
      expect(
        second.pendingContents.find((content) => content.endpointId === endpoint.id)!.body,
      ).toBe("帖子里说这套流程每次都要手动重来一遍。");
    } finally {
      await harness.dispose();
    }
  });

  test("只推地址的推送不是完整的推送", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("push-body", 33172);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const endpoint = await radarJson<Endpoint>(environment, [
        "sources", "add", "--channel", "agent-push",
        "--name", "某个板块", "--url", "https://example.invalid/r/elsewhere",
      ]);

      const noBody = await radar(
        environment,
        ["push", "--endpoint", endpoint.id],
        JSON.stringify([{ externalId: "t3_x", title: "只有个链接", originUrl: "https://example.invalid/x" }]),
      );
      expect(noBody.code).toBe(1);
      expect(noBody.stderr).toContain("只推地址不算完整的推送");

      // 一条不合契约就整批不落——不落一半。
      expect(
        (await radarJson<Endpoint[]>(environment, ["sources"])).find(
          (candidate) => candidate.id === endpoint.id,
        )!.lastPushAt,
      ).toBeNull();

      // Radar 自采的渠道不收推送：采集执行者是渠道那一档的说法（ADR 0011）。
      const selfCollected = await radar(
        environment, ["push", "--endpoint", "fixture-alpha"], JSON.stringify(pushed),
      );
      expect(selfCollected.code).toBe(1);
      expect(selfCollected.stderr).toContain("由 Radar 自采");

      // 停用的端点也不收。
      await radarJson(environment, ["sources", "disable", endpoint.id]);
      const disabled = await radar(
        environment, ["push", "--endpoint", endpoint.id], JSON.stringify(pushed),
      );
      expect(disabled.code).toBe(1);
      expect(disabled.stderr).toContain("已经停用了");
      await radarJson(environment, ["sources", "enable", endpoint.id]);

      const empty = await radar(environment, ["push", "--endpoint", endpoint.id], "[]");
      expect(empty.code).toBe(1);

      // 端点得先登记：推给一个不存在的端点如实报错，不会凭空造出来源。
      const unknown = await radar(
        environment, ["push", "--endpoint", "从来没登记过"], JSON.stringify(pushed),
      );
      expect(unknown.code).toBe(1);
      expect(unknown.stderr).toContain("找不到采集端点");
    } finally {
      await harness.dispose();
    }
  });

  test("Radar 里不出现任何登录态凭据——推送里夹带的额外字段一律不落盘", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("push-credentials", 33174);
    const { environment } = harness;
    try {
      const endpoint = await radarJson<Endpoint>(environment, [
        "sources", "add", "--channel", "agent-push",
        "--name", "某个板块", "--url", "https://example.invalid/r/creds",
      ]);

      await radarJson(
        environment,
        ["push", "--endpoint", endpoint.id],
        JSON.stringify([
          {
            ...pushed[0]!,
            cookie: "session=SUPER-SECRET-SESSION-TOKEN",
            authorization: "Bearer SUPER-SECRET-SESSION-TOKEN",
          },
        ]),
      );

      // 路由只认契约里那几个字段，夹带的一律丢掉。翻一遍数据目录里的每个文件。
      const files = await readdir(environment.dataDirectory);
      const dump = (
        await Promise.all(
          files.map(async (file) =>
            (await readFile(join(environment.dataDirectory, file))).toString("utf8"),
          ),
        )
      ).join("\n");

      // 先证明这一遍翻得到东西：推来的正文确实落在这里。
      expect(dump).toContain("帖子里说这套流程每次都要手动重来一遍。");
      expect(dump).not.toContain("SUPER-SECRET-SESSION-TOKEN");
    } finally {
      await harness.dispose();
    }
  });

  test("Radar 从不自己去采配置后解锁渠道的端点", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("push-nocollect", 33173);
    const { environment } = harness;
    try {
      const endpoint = await radarJson<Endpoint>(environment, [
        "sources", "add", "--channel", "agent-push",
        "--name", "够不着的板块", "--url", "https://example.invalid/r/unreachable",
      ]);

      // 就算点名催它，Radar 也不去——那个渠道 Radar 够不着。
      expect(
        await radarJson<{ status: string; skippedBecause?: string }>(
          environment, ["collect", "--endpoint", endpoint.id],
        ),
      ).toMatchObject({ status: "skipped", skippedBecause: "not_collectable" });

      const sweep = await radarJson<Array<{ endpointId: string; status: string }>>(
        environment, ["collect"],
      );
      expect(sweep.find((result) => result.endpointId === endpoint.id)!.status).toBe("skipped");

      const after = (await radarJson<Endpoint[]>(environment, ["sources"])).find(
        (candidate) => candidate.id === endpoint.id,
      )!;
      expect(after.lastAttemptAt).toBeNull();
      expect(after.consecutiveFailures).toBe(0);
    } finally {
      await harness.dispose();
    }
  });
});
