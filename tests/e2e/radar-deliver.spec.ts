import { expect, test } from "@playwright/test";
import { startHarness, waitForFirstCollection } from "./support/harness.js";
import { radar, radarJson } from "./support/radar-process.js";

/**
 * 取数角色：Agent 要出周报或者往 Obsidian 里写东西时，问 Radar 要「这个去处
 * 还没送过的判断」，送完标记一下。同一件事三周后再冒出来，它靠外部引用找得回
 * 上次那条笔记去改，而不是另起一条。
 */

type Brief = { id: string };
type WorkPackage = { pendingContents: Array<{ queueEntryId: string; sourceContentId: string; title: string }> };
type Judgment = { id: string; whatItIs: string; relatedJudgmentIds: string[] };
type Delivery = { judgmentId: string; destination: string; externalReference: string | null; deliveredAt: string };

const briefBody = "关注开发者反复表达、正在变化、可能还没被满足的需求与痛点。";

async function judgeEverything(
  environment: Parameters<typeof radarJson>[0],
  briefId: string,
): Promise<Judgment[]> {
  const workPackage = await radarJson<WorkPackage>(environment, ["pending", "--brief", briefId]);
  const judgments: Judgment[] = [];
  for (const content of workPackage.pendingContents) {
    judgments.push(
      await radarJson<Judgment>(
        environment,
        ["judge"],
        JSON.stringify({
          queueEntryId: content.queueEntryId,
          relevant: true,
          whatItIs: content.title,
          evidence: "原帖里写着。",
          uncertainty: "不确定是不是普遍现象。",
          whyForYou: "正是这条 Brief 关注的痛点。",
          judgedBy: "claude-code",
          signalContentIds: [content.sourceContentId],
        }),
      ),
    );
  }
  return judgments;
}

test.describe("取数角色", () => {
  test.describe.configure({ mode: "serial" });

  test("按去处各记各的，读到不算送到，外部引用原样留着", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("deliver", 33191);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await radarJson<Brief>(
        environment, ["brief", "create", "--name", "Demand Radar"], briefBody,
      );
      const judgments = await judgeEverything(environment, brief.id);
      expect(judgments).toHaveLength(3);

      // 读到不算送到：连着取两次，还是同样那几条。
      const first = await radarJson<Judgment[]>(
        environment, ["deliver", "take", "--brief", brief.id, "--to", "周报"],
      );
      expect(first.map((judgment) => judgment.id).sort()).toEqual(
        judgments.map((judgment) => judgment.id).sort(),
      );
      expect(
        (await radarJson<Judgment[]>(environment, ["deliver", "take", "--brief", brief.id, "--to", "周报"]))
          .length,
      ).toBe(3);

      const marked = await radarJson<Delivery>(environment, [
        "deliver", "mark", "--brief", brief.id, "--to", "周报",
        "--judgment", judgments[0]!.id, "--ref", "Radar/周报/2026-W35.md#痛点",
      ]);
      expect(marked.externalReference).toBe("Radar/周报/2026-W35.md#痛点");

      // 标记之后它离开增量，剩下两条。
      const remaining = await radarJson<Judgment[]>(
        environment, ["deliver", "take", "--brief", brief.id, "--to", "周报"],
      );
      expect(remaining.map((judgment) => judgment.id)).not.toContain(judgments[0]!.id);
      expect(remaining).toHaveLength(2);

      // 同一个判断送去别的去处：各记各的，obsidian 那边一条都没送过。
      expect(
        (await radarJson<Judgment[]>(environment, ["deliver", "take", "--brief", brief.id, "--to", "obsidian"]))
          .length,
      ).toBe(3);
      await radarJson(environment, [
        "deliver", "mark", "--brief", brief.id, "--to", "obsidian",
        "--judgment", judgments[0]!.id, "--ref", "vault/notes/abc123",
      ]);

      const history = await radarJson<Delivery[]>(
        environment, ["deliver", "history", "--brief", brief.id],
      );
      expect(history).toHaveLength(2);
      expect(new Set(history.map((row) => row.destination))).toEqual(new Set(["周报", "obsidian"]));
      // 三周后再冒出来时靠它找回上次那条笔记，所以它必须原样还在。
      expect(
        history.find((row) => row.destination === "obsidian")!.externalReference,
      ).toBe("vault/notes/abc123");
      expect(
        (await radarJson<Delivery[]>(environment, ["deliver", "history", "--brief", brief.id, "--to", "周报"]))
          .map((row) => row.externalReference),
      ).toEqual(["Radar/周报/2026-W35.md#痛点"]);
    } finally {
      await harness.dispose();
    }
  });

  test("至少一次交付：重复标记是幂等的，账实不符时能自己修回来", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("deliver-idempotent", 33192);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await radarJson<Brief>(
        environment, ["brief", "create", "--name", "Demand Radar"], briefBody,
      );
      const [judgment] = await judgeEverything(environment, brief.id);

      const once = await radarJson<Delivery>(environment, [
        "deliver", "mark", "--brief", brief.id, "--to", "周报",
        "--judgment", judgment!.id, "--ref", "Radar/周报/2026-W35.md",
      ]);
      // 网络重试打过来第二遍：不记成两笔，也不把已有的引用抹掉。
      const twice = await radarJson<Delivery>(environment, [
        "deliver", "mark", "--brief", brief.id, "--to", "周报", "--judgment", judgment!.id,
      ]);
      expect(twice.deliveredAt).toBe(once.deliveredAt);
      expect(twice.externalReference).toBe("Radar/周报/2026-W35.md");
      expect(
        await radarJson<Delivery[]>(environment, ["deliver", "history", "--brief", brief.id]),
      ).toHaveLength(1);

      // 引用变了就跟着更新——判断 id 是稳定的那一头。
      const moved = await radarJson<Delivery>(environment, [
        "deliver", "mark", "--brief", brief.id, "--to", "周报",
        "--judgment", judgment!.id, "--ref", "Radar/周报/2026-W36.md",
      ]);
      expect(moved.externalReference).toBe("Radar/周报/2026-W36.md");

      // 账实不符：标记了但其实没送出去。撤掉，它回到增量里。
      const removed = await radar(environment, [
        "deliver", "unmark", "--brief", brief.id, "--to", "周报", "--judgment", judgment!.id,
      ]);
      expect(removed.code).toBe(0);
      expect(
        (await radarJson<Judgment[]>(environment, ["deliver", "take", "--brief", brief.id, "--to", "周报"]))
          .map((row) => row.id),
      ).toContain(judgment!.id);

      const missing = await radar(environment, [
        "deliver", "unmark", "--brief", brief.id, "--to", "周报", "--judgment", judgment!.id,
      ]);
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain("没有交付到");
    } finally {
      await harness.dispose();
    }
  });

  test("也能按时间窗、按判断之间的关联链取材，不只取增量", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("deliver-chain", 33193);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await radarJson<Brief>(
        environment, ["brief", "create", "--name", "Demand Radar"], briefBody,
      );
      const workPackage = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);

      const judgments: Judgment[] = [];
      for (const [index, content] of workPackage.pendingContents.entries()) {
        judgments.push(
          await radarJson<Judgment>(
            environment,
            ["judge"],
            JSON.stringify({
              queueEntryId: content.queueEntryId,
              relevant: true,
              whatItIs: content.title,
              evidence: "原帖里写着。",
              uncertainty: "不确定是不是普遍现象。",
              whyForYou: "正是这条 Brief 关注的痛点。",
              judgedBy: "claude-code",
              signalContentIds: [content.sourceContentId],
              // 串成一条链：第二条挂第一条，第三条挂第二条。
              relatedJudgmentIds: index === 0 ? [] : [judgments[index - 1]!.id],
            }),
          ),
        );
      }
      expect(judgments[1]!.relatedJudgmentIds).toEqual([judgments[0]!.id]);

      // 顺着链走到底：从头一条出发，另外两条都在，方向无所谓。
      const chain = await radarJson<Judgment[]>(environment, [
        "deliver", "take", "--brief", brief.id, "--to", "周报", "--related-to", judgments[0]!.id,
      ]);
      expect(chain.map((judgment) => judgment.id).sort()).toEqual(
        [judgments[1]!.id, judgments[2]!.id].sort(),
      );

      // 时间窗：把窗口开在所有判断之前，一条都不该有。
      expect(
        await radarJson<Judgment[]>(environment, [
          "deliver", "take", "--brief", brief.id, "--to", "周报",
          "--until", "2020-01-01T00:00:00.000Z",
        ]),
      ).toEqual([]);
      expect(
        (await radarJson<Judgment[]>(environment, [
          "deliver", "take", "--brief", brief.id, "--to", "周报",
          "--since", "2020-01-01T00:00:00.000Z",
        ])).length,
      ).toBe(3);
    } finally {
      await harness.dispose();
    }
  });

  test("交付记录不保存输出本身", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("deliver-nooutput", 33194);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await radarJson<Brief>(
        environment, ["brief", "create", "--name", "Demand Radar"], briefBody,
      );
      const [judgment] = await judgeEverything(environment, brief.id);
      await radarJson(environment, [
        "deliver", "mark", "--brief", brief.id, "--to", "周报",
        "--judgment", judgment!.id, "--ref", "Radar/周报/2026-W35.md",
      ]);

      // 一条交付记录只有四个字段：判断、去处、外部引用、时间。没有正文。
      const [record] = await radarJson<Delivery[]>(
        environment, ["deliver", "history", "--brief", brief.id],
      );
      expect(Object.keys(record!).sort()).toEqual(
        ["deliveredAt", "destination", "externalReference", "judgmentId"],
      );
    } finally {
      await harness.dispose();
    }
  });
});
