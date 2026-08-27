import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createBriefWithAllSources, startHarness, waitForFirstCollection } from "./support/harness.js";
import { radar, radarJson, startRadar, stopRadar } from "./support/radar-process.js";

/**
 * 保留窗口与显式回捞。Radar 只排序不丢弃（ADR 0010）：过了窗口的内容移出
 * 待判断队列，但一行都不删——`radar requeue` 随时开一个新代次把它捞回来。
 */

type Brief = { id: string };
type WorkPackage = {
  pendingContents: Array<{ queueEntryId: string; sourceContentId: string; title: string }>;
  queueDepth: number;
};
type QueueStatus = { queueDepth: number; lastJudgedAt: string | null };

const briefBody = "关注开发者反复表达、正在变化、可能还没被满足的需求与痛点。";

/** 把队列代次的入队时间往前推——保留窗口是时间规则，验收里只能这样过时间。 */
function backdateQueue(dataDirectory: string, days: number): void {
  const db = new DatabaseSync(resolve(dataDirectory, "radar.sqlite"));
  const queuedAt = new Date(Date.now() - days * 86_400_000).toISOString();
  db.prepare("UPDATE queue_entries SET queued_at = ?").run(queuedAt);
  db.close();
}

test.describe("保留窗口与回捞", () => {
  test.describe.configure({ mode: "serial" });

  test("过了窗口移出待判断队列，但没删——回捞开一个新代次", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("retention", 33189);
    const { environment } = harness;
    let restarted: Awaited<ReturnType<typeof startRadar>> | null = null;
    try {
      await waitForFirstCollection(environment);
      const brief = await createBriefWithAllSources<Brief>(environment, "Demand Radar", briefBody);

      const before = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(before.pendingContents.length).toBeGreaterThan(0);
      const parked = before.pendingContents[0]!;

      // 默认 30 天，实例级可配（#43）。
      expect(await radarJson(environment, ["retention"])).toEqual({ days: 30 });
      expect(await radarJson(environment, ["retention", "--days", "7"])).toEqual({ days: 7 });

      await stopRadar(harness.radarProcess);
      backdateQueue(environment.dataDirectory, 30);
      restarted = await startRadar(environment.dataDirectory, {
        port: 33189,
        catalogPath: environment.catalogPath,
      });

      // 服务一起来就清扫：待判断队列空了。
      const swept = await radarJson<QueueStatus>(environment, ["queue", "--brief", brief.id]);
      expect(swept.queueDepth).toBe(0);
      expect(swept.lastJudgedAt).toBeNull();
      expect(
        (await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id])).pendingContents,
      ).toEqual([]);

      // 但内容还在，回捞就回来了——移出去不等于丢弃。
      const requeued = await radarJson<{ queueEntryId: string }>(environment, [
        "requeue", "--brief", brief.id, "--content", parked.sourceContentId,
      ]);
      expect(requeued.queueEntryId).not.toBe(parked.queueEntryId);

      const after = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(after.pendingContents.map((content) => content.sourceContentId)).toEqual([
        parked.sourceContentId,
      ]);

      // 已经在队列里的不用回捞，Radar 明说，不悄悄开第二个代次。
      const again = await radar(environment, [
        "requeue", "--brief", brief.id, "--content", parked.sourceContentId,
      ]);
      expect(again.code).toBe(1);
      expect(again.stderr).toContain("已经在待判断队列里");
    } finally {
      if (restarted) await stopRadar(restarted);
      await harness.dispose();
    }
  });

  test("判过的也能显式回捞重判，新代次是新代次", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("requeue", 33190);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await createBriefWithAllSources<Brief>(environment, "Demand Radar", briefBody);
      const workPackage = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      const content = workPackage.pendingContents[0]!;

      const judge = (queueEntryId: string, whyForYou: string): Promise<unknown> =>
        radarJson(environment, ["judge"], JSON.stringify({
          queueEntryId,
          relevant: true,
          whatItIs: content.title,
          evidence: "原帖里写着。",
          uncertainty: "不确定是不是普遍现象。",
          whyForYou,
          judgedBy: "claude-code",
        }));

      await judge(content.queueEntryId, "正是这条 Brief 关注的痛点。");
      // 同一个代次判第二次会被挡下——重判须显式回捞。
      const replay = await radar(environment, ["judge"], JSON.stringify({
        queueEntryId: content.queueEntryId,
        relevant: false,
        whyForYou: "改主意了。",
        judgedBy: "claude-code",
      }));
      expect(replay.code).toBe(1);
      expect(replay.stderr).toContain("要重判须显式回捞");

      const requeued = await radarJson<{ queueEntryId: string }>(environment, [
        "requeue", "--brief", brief.id, "--content", content.sourceContentId,
      ]);
      await judge(requeued.queueEntryId, "Brief 改了，这条现在算相关。");

      const status = await radarJson<QueueStatus>(environment, ["queue", "--brief", brief.id]);
      expect(status.lastJudgedAt).not.toBeNull();
      expect(
        (await radarJson<unknown[]>(environment, ["judgments", "--brief", brief.id])).length,
      ).toBe(2);
    } finally {
      await harness.dispose();
    }
  });
});
