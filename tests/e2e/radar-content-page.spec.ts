import { expect, test } from "@playwright/test";
import { startHarness, waitForFirstCollection, type Harness } from "./support/harness.js";
import { radarJson } from "./support/radar-process.js";

/**
 * 内容页（ADR 0017）：这台 Radar 到底给你攒下了什么。一条流加筛选，判过的
 * 四问原样摆着，判过没给的也摆出理由——只排序不丢弃（ADR 0010）。
 */

type Brief = { id: string; name: string };
type PendingContent = {
  queueEntryId: string;
  sourceContentId: string;
  title: string;
  endpointId: string;
};
type WorkPackage = { pendingContents: PendingContent[] };
type Judgment = { id: string };
type Endpoint = { id: string };

test.describe("内容页", () => {
  let harness: Harness;
  let origin: string;
  let brief: Brief;
  let kept: PendingContent;
  let dropped: PendingContent;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    harness = await startHarness("content-page", 33199);
    origin = `http://127.0.0.1:${harness.radarProcess.port}`;
    await waitForFirstCollection(harness.environment);

    brief = await radarJson<Brief>(
      harness.environment,
      ["brief", "create", "--name", "开发者的痛点"],
      "关注开发者反复抱怨、又没被满足的痛点。",
    );
    // 两条判断故意取自不同端点，来源筛选那条用例才有东西可筛。
    const work = await radarJson<WorkPackage>(harness.environment, ["pending", "--brief", brief.id]);
    kept = work.pendingContents.find((each) => each.endpointId === "fixture-alpha")!;
    dropped = work.pendingContents.find((each) => each.endpointId === "fixture-beta")!;

    await radarJson<Judgment>(
      harness.environment,
      ["judge"],
      JSON.stringify({
        queueEntryId: kept.queueEntryId,
        relevant: true,
        // Agent 按 Markdown 写，里面还夹着从原帖抄来的敌意片段。
        whatItIs: "一条关于证据可追溯的抱怨。\n\n- 删帖之后引用就断\n- 没有快照",
        evidence: "原帖说删帖之后引用就断了：<img src=x onerror=alert(1)>",
        uncertainty: "不知道这是普遍现象还是个例。",
        whyForYou: "这正是这条 Brief 关注的、**反复出现**又没被满足的痛点。[原帖](javascript:alert(1))",
        judgedBy: "claude-code",
      }),
    );
    await radarJson<Judgment>(
      harness.environment,
      ["judge"],
      JSON.stringify({
        queueEntryId: dropped.queueEntryId,
        relevant: false,
        whyForYou: "只是一条产品公告，跟痛点没关系。",
        judgedBy: "claude-code",
      }),
    );
  });

  test.afterAll(async () => {
    await harness.dispose();
  });

  const page = async (query = ""): Promise<string> => {
    const response = await fetch(`${origin}/${query}`);
    expect(response.ok).toBeTruthy();
    return response.text();
  };

  test("首页是内容页，来源页在 /sources", async () => {
    expect(await page()).toContain("开发者的痛点");
    const sources = await fetch(`${origin}/sources`);
    expect((await sources.text())).toContain('<ul class="sources">');
  });

  test("三档都在同一条流里，判过没给的带着理由", async () => {
    const text = await page();
    expect(text).toContain(">给你看<");
    expect(text).toContain(">判过没给<");
    expect(text).toContain(">还没轮到<");

    // 相关的摆四问，不相关的只摆淘汰理由——那三块本来就是空的。
    expect(text).toContain("这是什么");
    expect(text).toContain("凭什么这么说");
    expect(text).toContain("哪里还不确定");
    expect(text).toContain("为什么给你看");
    expect(text).toContain("为什么没给你");
    expect(text).toContain("只是一条产品公告，跟痛点没关系。");

    // 一条流，不是三个区块。
    expect(text.match(/<ul class="contents">/g)).toHaveLength(1);
  });

  test("筛选是链接，档与来源各自收窄", async () => {
    const forYou = await page(`?brief=${brief.id}&state=for_you`);
    expect(forYou).toContain(kept.title);
    expect(forYou).not.toContain(dropped.title);
    expect(forYou).toContain(">给你看<");
    expect(forYou).not.toContain(">还没轮到<");

    // 来源筛选把另一个端点的内容整条筛掉。端点保底配额让这两条判断分属两个
    // 端点（ADR 0010），正好拿来验筛选。
    expect(kept.endpointId).not.toBe(dropped.endpointId);
    const oneSource = await page(`?brief=${brief.id}&endpoint=${kept.endpointId}`);
    expect(oneSource).toContain(kept.title);
    expect(oneSource).not.toContain(dropped.title);
  });

  test("在一条判断上说「有用」，写进反馈并回到原来那一页", async () => {
    const back = `/?brief=${brief.id}&state=for_you`;
    const judgments = await radarJson<Array<{ id: string; relevant: boolean }>>(
      harness.environment,
      ["judgments", "--brief", brief.id],
    );
    const relevant = judgments.find((judgment) => judgment.relevant)!;

    const said = await fetch(`${origin}/content/feedback`, {
      method: "POST",
      headers: { origin },
      body: new URLSearchParams({
        briefId: brief.id,
        judgmentId: relevant.id,
        disposition: "useful",
        back,
      }),
      redirect: "manual",
    });
    expect(said.status).toBe(303);
    expect(said.headers.get("location")).toBe(back);

    // 写进的是反馈，下一次判断时 AI 看得到。
    const feedback = (await (await fetch(`${origin}/briefs/${brief.id}/feedback`)).json()) as Array<{
      judgmentId: string | null;
      disposition: string;
    }>;
    expect(
      feedback.some((each) => each.judgmentId === relevant.id && each.disposition === "useful"),
    ).toBe(true);

    // 说过的话摆在条目旁边，按钮收起来——同一条不会被反复点。
    expect(await page(`?brief=${brief.id}&state=for_you`)).toContain("你说过：有用");

    // 跨站的表单 POST 写不进反馈。
    const crossSite = await fetch(`${origin}/content/feedback`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: new URLSearchParams({ briefId: brief.id, judgmentId: relevant.id, disposition: "useful" }),
      redirect: "manual",
    });
    expect(crossSite.status).toBe(403);
  });

  test("原文地址不是 http(s) 就不给链接——标题还在，只是点不动", async () => {
    // 推送来的内容由用户自己的 Agent 采（ADR 0011），地址是第三方给的。
    // 转义挡得住把标签写进属性值，挡不住 `javascript:`。
    const endpoint = await radarJson<Endpoint>(harness.environment, [
      "sources", "add", "--channel", "agent-push",
      "--name", "推送来的板块", "--url", "https://example.invalid/pushed",
    ]);
    await radarJson(
      harness.environment,
      ["push", "--endpoint", endpoint.id],
      JSON.stringify([
        {
          externalId: "hostile-1",
          title: "地址是个 javascript: 伪协议",
          originUrl: 'javascript:alert("xss")',
          body: "正文照常。",
          publishedAt: "2026-08-25T02:00:00.000Z",
        },
      ]),
    );

    const text = await page(`?brief=${brief.id}&state=pending`);
    expect(text).toContain("地址是个 javascript: 伪协议");
    expect(text).toContain('<span class="content-title">');
    expect(text).not.toContain("href=\"javascript:");
  });

  test("Agent 写的文本按 Markdown 渲染，原始标签照样转义", async () => {
    const text = await page(`?brief=${brief.id}&state=for_you`);
    // 判断的四问是 Agent 写的，按 Markdown 写就按 Markdown 摆。
    expect(text).toContain("<strong>反复出现</strong>");
    expect(text).toContain("<li>");
    // 渲染成 HTML 不等于放行 HTML：原始标签转义，`javascript:` 留成文本。
    expect(text).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(text).not.toContain('href="javascript:');
  });

  test("服务端渲染，不引入 JSX 运行时", async () => {
    expect(await page()).not.toContain("<script");
  });
});
