import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createBriefWithAllSources, startHarness, waitForFirstCollection } from "./support/harness.js";
import { radar, radarJson, stopRadar } from "./support/radar-process.js";

/**
 * 完整导出：用户想把东西带走，或者想在 Radar 之外读自己积累的判断，一条命令
 * 拿到一份完整档案——不需要 Radar 还活着，也不需要懂 SQLite。
 */

type WorkPackage = {
  pendingContents: Array<{ queueEntryId: string; sourceContentId: string; title: string }>;
};
type Judgment = { id: string };
type Archive = {
  brief: { id: string; name: string };
  revisions: Array<{ number: number; body: string }>;
  sourceContents: Array<{ id: string; title: string; body: string; originUrl: string }>;
  judgments: Array<{ id: string; relevant: boolean; whyForYou: string }>;
  feedback: Array<{ note: string }>;
  deliveries: Array<{ destination: string; externalReference: string | null }>;
};

test.describe("完整导出", () => {
  test.describe.configure({ mode: "serial" });

  test("一条命令拿到完整档案：可机读加可直接读，脱离实例也读得完", async () => {
    test.setTimeout(180_000);
    const harness = await startHarness("export", 33210);
    const outputDirectory = await mkdtemp(join(tmpdir(), "radar-export-out-"));
    try {
      await waitForFirstCollection(harness.environment);
      const brief = await createBriefWithAllSources<{ id: string }>(harness.environment, "Demand Radar", "关注开发者反复抱怨、还没被满足的痛点。");
      // 另一条 Brief 也在同一个实例里判着东西——它不该出现在这份档案里。
      const other = await createBriefWithAllSources<{ id: string }>(harness.environment, "别的关注线", "另一条完全无关的关注线。");

      const work = await radarJson<WorkPackage>(harness.environment, ["pending", "--brief", brief.id]);
      const pain = work.pendingContents.find((content) => content.title.includes("证据留不住"))!;
      const job = work.pendingContents.find((content) => content.title.includes("招聘帖"))!;
      const kept = await radarJson<Judgment>(
        harness.environment,
        ["judge"],
        JSON.stringify({
          queueEntryId: pain.queueEntryId,
          relevant: true,
          whatItIs: "一条关于证据可追溯的抱怨。",
          evidence: "原帖说删帖之后引用就断了。",
          uncertainty: "不知道这是普遍现象还是个例。",
          whyForYou: "这正是这条 Brief 关注的痛点。",
          judgedBy: "claude-code",
          signalContentIds: [pain.sourceContentId],
        }),
      );
      await radar(
        harness.environment,
        ["judge"],
        JSON.stringify({
          queueEntryId: job.queueEntryId,
          relevant: false,
          whyForYou: "招聘帖不是痛点。",
          judgedBy: "claude-code",
        }),
      );
      await radar(
        harness.environment,
        ["feedback", "--brief", brief.id, "--judgment", kept.id, "--disposition", "少给这类"],
        "招聘帖一律不要。",
      );
      await radar(harness.environment, [
        "deliver", "mark", "--brief", brief.id, "--to", "obsidian",
        "--judgment", kept.id, "--ref", "notes/2026-08-25.md",
      ]);

      // 另一条 Brief 上也判一条，正文写得一眼认得出来。
      const otherWork = await radarJson<WorkPackage>(
        harness.environment, ["pending", "--brief", other.id],
      );
      await radar(
        harness.environment,
        ["judge"],
        JSON.stringify({
          queueEntryId: otherWork.pendingContents[0]!.queueEntryId,
          relevant: true,
          whatItIs: "另一条关注线的判断。",
          evidence: "另一条关注线的依据。",
          uncertainty: "另一条关注线的不确定。",
          whyForYou: "这条只属于别的关注线。",
          judgedBy: "claude-code",
        }),
      );

      // 导出前后领域数据一模一样——导出是只读操作。
      const before = await radarJson<unknown>(harness.environment, ["judgments", "--brief", brief.id]);
      const [written] = await radarJson<Array<{ machineReadable: string; readable: string }>>(
        harness.environment, ["export", "--brief", brief.id, "--dir", outputDirectory],
      );
      expect(await radarJson<unknown>(harness.environment, ["judgments", "--brief", brief.id]))
        .toEqual(before);

      // Radar 停了，档案照样读得完——它就是两个普通文件。
      await stopRadar(harness.radarProcess);
      const archive = JSON.parse(await readFile(written!.machineReadable, "utf8")) as Archive;
      const readable = await readFile(written!.readable, "utf8");

      // 可机读结构：Brief 及其修订、来源内容（含正文快照）、判断、反馈、交付记录。
      expect(archive.brief.name).toBe("Demand Radar");
      expect(archive.revisions[0]!.body).toBe("关注开发者反复抱怨、还没被满足的痛点。");
      expect(archive.judgments).toHaveLength(2);
      expect(archive.judgments.some((judgment) => !judgment.relevant)).toBe(true);
      expect(archive.feedback.map((item) => item.note)).toEqual(["招聘帖一律不要。"]);
      expect(archive.deliveries).toEqual([
        expect.objectContaining({ destination: "obsidian", externalReference: "notes/2026-08-25.md" }),
      ]);
      const snapshot = archive.sourceContents.find((content) => content.id === pain.sourceContentId)!;
      expect(snapshot.body).toBe("帖子里反复出现同一个诉求：删帖之后引用就断了。");

      // 可直接阅读的那一份：判断连着依据、来源与交付，正文快照也在里面。
      expect(readable).toContain("# Demand Radar");
      expect(readable).toContain("关注开发者反复抱怨、还没被满足的痛点。");
      expect(readable).toContain("这正是这条 Brief 关注的痛点。");
      expect(readable).toContain("招聘帖不是痛点。");
      expect(readable).toContain("招聘帖一律不要。");
      expect(readable).toContain("obsidian");
      expect(readable).toContain("notes/2026-08-25.md");
      expect(readable).toContain("帖子里反复出现同一个诉求：删帖之后引用就断了。");

      // 单个 Brief 的导出不依赖其他 Brief：别的关注线一个字都不在里面。
      expect(JSON.stringify(archive)).not.toContain(other.id);
      expect(JSON.stringify(archive)).not.toContain("另一条关注线");
      expect(readable).not.toContain("另一条关注线");

      // 来源授权凭据是本地 secret，不进导出。
      expect(JSON.stringify(archive)).not.toMatch(/token|cookie|api[_-]?key|secret|password/i);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
      await harness.dispose();
    }
  });

  test("不点名 Brief 就把东西全带走，每个一个自成一体的子目录", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("export-all", 33211);
    const outputDirectory = await mkdtemp(join(tmpdir(), "radar-export-all-"));
    try {
      const first = await createBriefWithAllSources<{ id: string }>(harness.environment, "第一条线", "第一条线的正文。");
      const second = await createBriefWithAllSources<{ id: string }>(harness.environment, "第二条线", "第二条线的正文。");

      const written = await radarJson<Array<{ brief: string; machineReadable: string }>>(
        harness.environment, ["export", "--dir", outputDirectory],
      );
      expect(written.map((entry) => entry.brief).sort()).toEqual(["第一条线", "第二条线"]);
      for (const [briefId, name] of [[first.id, "第一条线"], [second.id, "第二条线"]] as const) {
        const archive = JSON.parse(
          await readFile(join(outputDirectory, briefId, "export.json"), "utf8"),
        ) as Archive;
        expect(archive.brief.name).toBe(name);
        // 每一份都自成一体：另一条线不在里面。
        expect(JSON.stringify(archive)).not.toContain(name === "第一条线" ? "第二条线" : "第一条线");
      }
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
      await harness.dispose();
    }
  });
});
