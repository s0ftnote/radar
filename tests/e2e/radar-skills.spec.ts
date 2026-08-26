import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { startHarness, waitForFirstCollection } from "./support/harness.js";
import { delay, radar, radarJson, repositoryRoot, stopRadar } from "./support/radar-process.js";

/**
 * 三份 Skill 与安装。验收是**两个完整周期**：建 Brief → 采集 → 判断 → 交付记账
 * → 写反馈 → 下一周期的工作包里读到那条反馈。文件复制到位不算完成。
 */

type Brief = { id: string };
type PendingContent = { queueEntryId: string; sourceContentId: string; title: string };
type WorkPackage = {
  brief: { id: string; revision: { body: string } };
  pendingContents: PendingContent[];
  feedback: Array<{ disposition: string; note: string }>;
  recentJudgments: Array<{ id: string; title: string }>;
};
type Judgment = { id: string; whatItIs: string };

const briefBody = "关注开发者反复表达、正在变化、可能还没被满足的需求与痛点。";

/** model-invoked 靠的是 description 写清了用户会说什么，Agent 才认得出该用哪份。 */
const triggerPhrases: Record<string, RegExp> = {
  // 用户读报告时随口一句「这条没意思」，管家角色要认得出那是反馈。
  "radar-steward": /这条没意思/,
  "radar-judgment": /待判断|最近有什么/,
  "radar-delivery": /周报|Obsidian/,
};

const judgeContract = (content: PendingContent, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    queueEntryId: content.queueEntryId,
    relevant: true,
    whatItIs: content.title,
    evidence: "原帖里写着。",
    uncertainty: "不确定是不是普遍现象。",
    whyForYou: "正是这条 Brief 关注的痛点。",
    judgedBy: "claude-code",
    signalContentIds: [content.sourceContentId],
    ...extra,
  });

test.describe("三份 Skill 与安装", () => {
  test.describe.configure({ mode: "serial" });

  test("三份随仓库来的 Skill 都是 model-invoked，只写时机不写用法", () => {
    const source = resolve(repositoryRoot, "skills");
    const names = readdirSync(source).sort();
    expect(names).toEqual(["radar-delivery", "radar-judgment", "radar-steward"]);

    for (const name of names) {
      const text = readFileSync(join(source, name, "SKILL.md"), "utf8");
      const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
      expect(frontMatter, `${name} 缺 front matter`).not.toBeNull();
      expect(frontMatter![1]).toContain(`name: ${name}`);
      // model-invoked 靠的就是 description：Agent 自己认出该用它，用户不必点名。
      const description = /\ndescription: (.+)/.exec(frontMatter![1])?.[1] ?? "";
      expect(description.length, `${name} 的 description 太短，触发不了`).toBeGreaterThan(40);
      // description 里要写清用户会说什么，不是这份 skill 叫什么。
      expect(description, `${name} 的 description 没写触发的场合`).toMatch(triggerPhrases[name]!);

      // 用法现场 `radar --help`，不抄进 Skill（ADR 0012）。
      expect(text).toContain("radar --help");
      // 抄用法的标志是抄参数占位符——那正是 `--help` 里会变的那部分。
      expect(text, `${name} 抄了命令用法`).not.toMatch(/radar [\w -]*<\S+>/);
      // 不做 Skill / CLI 版本检测，不要契约版本号。
      expect(text).not.toMatch(/契约版本|版本检测|--version/);
    }

    // 管家一侧是三者之间唯一的耦合：建完 Brief 催采集，再自行接上判断角色。
    const steward = readFileSync(join(source, "radar-steward", "SKILL.md"), "utf8");
    expect(steward).toContain("radar collect");
    expect(steward).toContain("radar-judgment");
  });

  test("radar skills install 幂等覆盖，装的是随本版 Radar 来的那三份", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "radar-skills-data-"));
    const target = await mkdtemp(join(tmpdir(), "radar-skills-"));
    try {
      // 目标目录里本来就有别人的 Skill——那是常态，~/.claude/skills 不是空的。
      mkdirSync(join(target, "someone-elses-skill"));
      writeFileSync(join(target, "someone-elses-skill", "SKILL.md"), "不是 Radar 装的。");

      const first = await radar({ dataDirectory }, ["skills", "install", "--dir", target]);
      expect(first.code).toBe(0);
      expect(readdirSync(target).sort()).toEqual([
        "radar-delivery", "radar-judgment", "radar-steward", "someone-elses-skill",
      ]);

      // 上一版留下的文件不该赖着不走，装第二次结果一模一样。
      writeFileSync(join(target, "radar-steward", "STALE.md"), "上一版留下的");
      const second = await radar({ dataDirectory }, ["skills", "install", "--dir", target]);
      expect(second.code).toBe(0);
      expect(readdirSync(join(target, "radar-steward"))).toEqual(["SKILL.md"]);

      // 只碰自己那三份：别人的 Skill 原样还在。
      expect(readFileSync(join(target, "someone-elses-skill", "SKILL.md"), "utf8"))
        .toBe("不是 Radar 装的。");

      // 装的就是仓库里那份，不是另抄一份。
      expect(readFileSync(join(target, "radar-steward", "SKILL.md"), "utf8")).toBe(
        readFileSync(resolve(repositoryRoot, "skills/radar-steward/SKILL.md"), "utf8"),
      );
    } finally {
      await rm(target, { recursive: true, force: true });
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  test("两周期端到端：反馈在下一周期的工作包里读得到", async () => {
    test.setTimeout(180_000);
    // 渠道节奏调到 1 秒：`radar collect` 不绕过渠道速率限制（#45），两周期
    // 之间必须真的到点，才谈得上第二次采集。
    const harness = await startHarness("skills-e2e", 33196, 1);
    const { environment, feed } = harness;
    try {
      await waitForFirstCollection(environment);

      // —— 第一周期 ——
      // 管家：建 Brief，建完立刻催一次采集。
      const brief = await radarJson<Brief>(
        environment, ["brief", "create", "--name", "Demand Radar"], briefBody,
      );
      expect((await radar(environment, ["collect"])).code).toBe(0);

      // 判断：取工作包，逐条判断。
      const first = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      expect(first.brief.revision.body).toBe(briefBody);
      expect(first.pendingContents.length).toBeGreaterThan(0);
      const judgments: Judgment[] = [];
      for (const content of first.pendingContents) {
        judgments.push(
          await radarJson<Judgment>(environment, ["judge"], judgeContract(content)),
        );
      }

      // 取数：取素材，送出去，按去处记一笔账。
      const material = await radarJson<Judgment[]>(environment, [
        "deliver", "take", "--brief", brief.id, "--to", "周报",
      ]);
      expect(material.map((judgment) => judgment.id).sort())
        .toEqual(judgments.map((judgment) => judgment.id).sort());
      expect((await radar(environment, [
        "deliver", "mark", "--brief", brief.id, "--to", "周报",
        "--judgment", judgments[0]!.id, "--ref", "周报/2026-W35.md",
      ])).code).toBe(0);

      // 管家：用户读报告时随口一句，那就是反馈。
      expect((await radar(
        environment,
        ["feedback", "--brief", brief.id, "--judgment", judgments[0]!.id,
         "--disposition", "not_interesting"],
        "招聘帖这类别再给我了。",
      )).code).toBe(0);

      // —— 第二周期 ——
      feed.addEntry({
        guid: "alpha-3",
        title: "又一波关于证据留存的抱怨",
        body: "这周同一个诉求又冒出来了。",
        publishedAt: "Mon, 31 Aug 2026 09:00:00 GMT",
      });
      await delay(1_100);
      expect((await radar(environment, ["collect"])).code).toBe(0);

      const second = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      // 上一周期写下的反馈，这一周期读得到——这是整个系统唯一的学习回路。
      expect(second.feedback.map((entry) => entry.note)).toContain("招聘帖这类别再给我了。");
      // 判过的不会再出现，新采到的会。
      expect(second.pendingContents.map((content) => content.title))
        .toEqual(["又一波关于证据留存的抱怨"]);
      expect(second.recentJudgments.map((judgment) => judgment.id).sort())
        .toEqual(judgments.map((judgment) => judgment.id).sort());

      // 已经送过的不会再进增量，没送过的还在。
      expect(
        (await radarJson<Judgment[]>(environment, [
          "deliver", "take", "--brief", brief.id, "--to", "周报",
        ])).map((judgment) => judgment.id),
      ).not.toContain(judgments[0]!.id);
    } finally {
      await harness.dispose();
    }
  });

  test("异常路径：服务离线时如实报错，重复调用不产生重复判断，部分失败可恢复", async () => {
    test.setTimeout(180_000);
    const harness = await startHarness("skills-offline", 33197);
    const { environment } = harness;
    try {
      await waitForFirstCollection(environment);
      const brief = await radarJson<Brief>(
        environment, ["brief", "create", "--name", "Demand Radar"], briefBody,
      );
      const workPackage = await radarJson<WorkPackage>(environment, ["pending", "--brief", brief.id]);
      const [first, second] = workPackage.pendingContents;

      // 重复调用不产生重复判断：同一个幂等键，同一条判断。
      const once = await radarJson<Judgment>(
        environment, ["judge"], judgeContract(first!, { idempotencyKey: "retry-1" }),
      );
      const again = await radarJson<Judgment>(
        environment, ["judge"], judgeContract(first!, { idempotencyKey: "retry-1" }),
      );
      expect(again.id).toBe(once.id);
      expect(await radarJson<Judgment[]>(environment, ["judgments", "--brief", brief.id]))
        .toHaveLength(1);

      // 部分失败可恢复：一条写坏了，剩下的照写，坏的那条还在队列里等着。
      const broken = await radar(
        environment, ["judge"], judgeContract(second!, { whyForYou: "" }),
      );
      expect(broken.code).not.toBe(0);
      expect(
        await radarJson<Judgment>(environment, ["judge"], judgeContract(second!)),
      ).toHaveProperty("id");

      // 服务离线：如实报错，不瞎编。
      await stopRadar(harness.radarProcess);
      const offline = await radar(environment, ["pending", "--brief", brief.id]);
      expect(offline.code).not.toBe(0);
      expect(offline.stderr).toContain("radar up");
      expect(offline.stdout).toBe("");
    } finally {
      await harness.dispose();
    }
  });
});
