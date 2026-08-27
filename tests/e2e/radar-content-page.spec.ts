import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { createBriefWithAllSources, startHarness, type Harness } from "./support/harness.js";
import { radarJson } from "./support/radar-process.js";

type Brief = { id: string; name: string };
type PendingContent = { queueEntryId: string; sourceContentId: string; title: string };
type WorkPackage = { pendingContents: PendingContent[] };
type Judgment = { id: string; whyForYou: string };
type Report = { id: string; briefId: string; title: string; body: string };

test.describe("Radar WebUI", () => {
  test.describe.configure({ mode: "serial" });

  let harness: Harness;
  let origin: string;
  let brief: Brief;
  let kept: PendingContent;
  let judgment: Judgment;
  let report: Report;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    harness = await startHarness("webui", 33199);
    origin = `http://127.0.0.1:${harness.radarProcess.port}`;

    brief = await createBriefWithAllSources<Brief>(
      harness.environment,
      "开发者的痛点",
      "关注开发者反复抱怨、又没被满足的痛点。",
    );
    const work = await radarJson<WorkPackage>(harness.environment, ["pending", "--brief", brief.id]);
    kept = work.pendingContents[0]!;
    judgment = await radarJson<Judgment>(
      harness.environment,
      ["judge"],
      JSON.stringify({
        queueEntryId: kept.queueEntryId,
        relevant: true,
        whatItIs: "开发者反复提到：原帖删除后，引用证据就会中断。",
        evidence: "原帖明确描述了删帖后引用失效，并给出实际使用场景。",
        uncertainty: "暂时不知道这是普遍现象还是单一社区的高频问题。",
        tags: ["证据留存", "开发者痛点"],
        whyForYou: "它符合 Brief 中反复出现、尚未解决的开发者痛点。",
        judgedBy: "codex",
      }),
    );
  });

  test.afterAll(async () => {
    await harness.dispose();
  });

  test("首页是任务工作台，并永久提供三个可复制 Skill", async () => {
    const text = await (await fetch(origin)).text();
    expect(text).toContain("开发者的痛点");
    expect(text).toContain("/radar-steward");
    expect(text).toContain("/radar-delivery");
    expect(text).toContain("/open-radar");
    expect(text).toContain("/assets/app.js");
    expect(text).not.toContain("新手引导");
  });

  test("任务详情同时展示 Brief、来源、内容和报告区域", async () => {
    const text = await (await fetch(`${origin}/tasks/${brief.id}`)).text();
    expect(text).toContain("关注开发者反复抱怨");
    expect(text).toContain("Fixture Alpha");
    expect(text).toContain(kept.title);
    expect(text).toContain("Agent 生成");
  });

  test("文档详情展示摘要、标签、作者平台和安全的原文入口", async () => {
    const text = await (
      await fetch(`${origin}/tasks/${brief.id}/documents/${kept.sourceContentId}`)
    ).text();
    expect(text).toContain("摘要");
    expect(text).toContain("开发者反复提到");
    expect(text).toContain("证据留存");
    expect(text).toContain("开发者痛点");
    expect(text).not.toContain(">devtools<");
    expect(text).toContain("原文");
    expect(text).toContain("Fixture Alpha");
    expect(text).not.toContain('href="javascript:');
  });

  test("Agent 保存报告后，任务页与报告详情实时共用同一份正文", async () => {
    report = await radarJson<Report>(
      harness.environment,
      [
        "report", "create", "--brief", brief.id,
        "--title", "开发者痛点周报", "--by", "codex",
        "--judgment", judgment.id, "--idempotency-key", "report-week-35",
      ],
      "# 本周判断\n\n证据留存仍然是反复出现的问题。",
    );
    const replayed = await radarJson<Report>(
      harness.environment,
      [
        "report", "create", "--brief", brief.id,
        "--title", "开发者痛点周报", "--by", "codex",
        "--judgment", judgment.id, "--idempotency-key", "report-week-35",
      ],
      "# 本周判断\n\n证据留存仍然是反复出现的问题。",
    );
    expect(replayed.id).toBe(report.id);

    const task = await (await fetch(`${origin}/tasks/${brief.id}`)).text();
    expect(task).toContain("开发者痛点周报");
    const reportPage = await (await fetch(`${origin}/reports/${report.id}`)).text();
    expect(reportPage).toContain("本周判断");
    expect(reportPage).toContain("证据留存仍然是反复出现的问题");
    expect(reportPage).toContain(kept.title);
    expect(reportPage).toContain("引用判断");
  });

  test("相同报告幂等键只在各自任务内重放", async () => {
    const anotherBrief = await createBriefWithAllSources<Brief>(
      harness.environment,
      "第二条雷达",
      "关注本地优先产品。",
    );
    const work = await radarJson<WorkPackage>(harness.environment, [
      "pending", "--brief", anotherBrief.id,
    ]);
    const anotherJudgment = await radarJson<Judgment>(
      harness.environment,
      ["judge"],
      JSON.stringify({
        queueEntryId: work.pendingContents[0]!.queueEntryId,
        relevant: true,
        whatItIs: "一条本地优先产品信号。",
        evidence: "正文讨论本地所有权。",
        uncertainty: "尚未验证市场规模。",
        tags: ["本地优先"],
        whyForYou: "符合第二条 Brief。",
        judgedBy: "codex",
      }),
    );
    const anotherReport = await radarJson<Report>(
      harness.environment,
      [
        "report", "create", "--brief", anotherBrief.id,
        "--title", "第二份报告", "--by", "codex",
        "--judgment", anotherJudgment.id, "--idempotency-key", "report-week-35",
      ],
      "# 第二份报告\n\n这是另一条任务的独立产物。",
    );
    expect(anotherReport.id).not.toBe(report.id);
    expect(anotherReport.briefId).toBe(anotherBrief.id);

    await fetch(`${origin}/tasks/${anotherBrief.id}/delete`, {
      method: "POST",
      headers: { origin },
      redirect: "manual",
    });
  });

  test("重判后历史报告仍固定引用当时的判断", async () => {
    const requeued = await radarJson<{ queueEntryId: string }>(harness.environment, [
      "requeue", "--brief", brief.id, "--content", kept.sourceContentId,
    ]);
    const latest = await radarJson<Judgment>(
      harness.environment,
      ["judge"],
      JSON.stringify({
        queueEntryId: requeued.queueEntryId,
        relevant: true,
        whatItIs: "重判后的内容摘要。",
        evidence: "重判后的证据。",
        uncertainty: "重判后的不确定性。",
        tags: ["重新判断"],
        whyForYou: "这次重判采用了更新后的判断边界。",
        judgedBy: "codex",
      }),
    );

    const historicalReport = await (await fetch(`${origin}/reports/${report.id}`)).text();
    expect(historicalReport).toContain(judgment.whyForYou);
    expect(historicalReport).not.toContain(latest.whyForYou);
    expect(historicalReport).toContain(`?judgment=${judgment.id}`);

    const historicalDocument = await (
      await fetch(
        `${origin}/tasks/${brief.id}/documents/${kept.sourceContentId}?judgment=${judgment.id}`,
      )
    ).text();
    expect(historicalDocument).toContain(judgment.whyForYou);
    expect(historicalDocument).not.toContain(latest.whyForYou);

    const currentDocument = await (
      await fetch(`${origin}/tasks/${brief.id}/documents/${kept.sourceContentId}`)
    ).text();
    expect(currentDocument).toContain(latest.whyForYou);
    expect(currentDocument).toContain("重新判断");
    judgment = latest;
  });

  test("WebUI 可以修改任务名称和 Brief，并形成新修订", async () => {
    const changed = await fetch(`${origin}/tasks/${brief.id}`, {
      method: "POST",
      headers: { origin },
      body: new URLSearchParams({
        name: "开发者需求雷达",
        body: "只关注有直接用户证据、正在重复出现的开发者需求。",
        rationale: "收紧判断边界",
      }),
      redirect: "manual",
    });
    expect(changed.status).toBe(303);
    const text = await (await fetch(`${origin}/tasks/${brief.id}`)).text();
    expect(text).toContain("开发者需求雷达");
    expect(text).toContain("只关注有直接用户证据");
    expect(text).toContain("第 2 版");
  });

  test("WebUI 的成功写操作会通过事件流通知已打开的页面", async () => {
    const controller = new AbortController();
    const response = await fetch(`${origin}/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: ready");

    await fetch(`${origin}/content/feedback`, {
      method: "POST",
      headers: { origin },
      body: new URLSearchParams({
        briefId: brief.id,
        judgmentId: judgment.id,
        disposition: "useful",
        back: `/tasks/${brief.id}/documents/${kept.sourceContentId}`,
      }),
      redirect: "manual",
    });

    let event = "";
    const deadline = Date.now() + 3_000;
    while (!event.includes("event: radar") && Date.now() < deadline) {
      const chunk = await reader.read();
      event += new TextDecoder().decode(chunk.value);
    }
    controller.abort();
    expect(event).toContain("event: radar");
  });

  test("任务从 WebUI 移除后，完整历史仍保留在实例中", async () => {
    const removed = await fetch(`${origin}/tasks/${brief.id}/delete`, {
      method: "POST",
      headers: { origin },
      redirect: "manual",
    });
    expect(removed.status).toBe(303);
    const home = await (await fetch(origin)).text();
    expect(home).toContain("这里还没有任务");
    expect(home).not.toContain(`/tasks/${brief.id}`);

    const db = new DatabaseSync(join(harness.environment.dataDirectory, "radar.sqlite"));
    try {
      const archived = db.prepare("SELECT archived_at FROM briefs WHERE id = ?").get(brief.id) as
        | { archived_at: string | null }
        | undefined;
      const judgments = db
        .prepare("SELECT COUNT(*) AS count FROM judgments WHERE brief_id = ?")
        .get(brief.id) as { count: number };
      const reports = db
        .prepare("SELECT COUNT(*) AS count FROM reports WHERE brief_id = ?")
        .get(brief.id) as { count: number };
      expect(archived?.archived_at).not.toBeNull();
      expect(judgments.count).toBeGreaterThanOrEqual(2);
      expect(reports.count).toBe(1);
    } finally {
      db.close();
    }
  });
});
