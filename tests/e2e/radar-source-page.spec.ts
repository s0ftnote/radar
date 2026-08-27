import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startFeedFixture, type FeedFixture } from "./support/feed-fixture.js";
import { radar, radarJson, startRadar, stopRadar, type RunningRadar } from "./support/radar-process.js";
import type { Endpoint } from "./support/harness.js";

/**
 * 来源页（ADR 0013）：一眼看清这台 Radar 现在在采什么、什么坏了、什么在等推送，
 * 以及目录里还摆着什么可以加。看归网页，改归对话——页面上的动作只有实例级停用
 * 与「纳入到某条 Brief」两个（#104）。
 */

/** 端点名与错误原因都来自第三方，直接拼进模板字符串就是存储型 XSS。 */
const injected = '<script>alert("xss")</script>';

async function pageCatalog(directory: string, feed: FeedFixture): Promise<string> {
  const path = join(directory, "catalog.json");
  const license = { basis: "publisher-provided-feed", reference: `${feed.url}/terms` };
  await writeFile(
    path,
    JSON.stringify({
      catalogVersion: 1,
      channels: [
        { id: "rss", name: "RSS / Atom", configState: "ready", collectionIntervalSeconds: 900 },
        {
          id: "agent-push",
          name: "配置后解锁（Agent 推送）",
          configState: "unlocked_by_config",
          collectionIntervalSeconds: 900,
        },
        {
          id: "walled",
          name: "够不着的渠道",
          configState: "unreachable",
          collectionIntervalSeconds: 900,
        },
      ],
      endpoints: [
        {
          id: "ok",
          channelId: "rss",
          name: "正常的源",
          url: `${feed.url}/alpha`,
          topics: ["devtools", "systems"],
          licenseBasis: license,
        },
        { id: "broken", channelId: "rss", name: injected, url: `${feed.url}/missing`, licenseBasis: license },
        {
          id: "gone",
          channelId: "rss",
          name: "搬走了的源",
          url: `${feed.url}/gone`,
          licenseBasis: license,
          retired: `站点关了，官方 feed 不再更新。${injected}`,
        },
        { id: "pushed", channelId: "agent-push", name: "要登录才看得到", url: "https://example.test/pushed", licenseBasis: license },
        {
          id: "spare",
          channelId: "rss",
          name: "目录里还摆着的源",
          url: `${feed.url}/beta`,
          topics: ["product"],
          licenseBasis: license,
        },
        { id: "walled-off", channelId: "walled", name: "够不着的源", url: "https://example.test/walled", licenseBasis: license },
      ],
    }),
  );
  return path;
}

test.describe("来源页", () => {
  test.describe.configure({ mode: "serial" });

  let feed: FeedFixture;
  let dataDirectory: string;
  let radarProcess: RunningRadar;
  let environment: { dataDirectory: string; catalogPath: string };
  let origin: string;
  let brief: { id: string };

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    dataDirectory = await mkdtemp(join(tmpdir(), "radar-page-"));
    feed = await startFeedFixture();
    const catalogPath = await pageCatalog(dataDirectory, feed);
    environment = { dataDirectory, catalogPath };
    radarProcess = await startRadar(dataDirectory, { port: 33198, catalogPath });
    origin = `http://127.0.0.1:${radarProcess.port}`;
    // Radar 只采被纳入的端点（#104）：先建一条 Brief，把要在「在采的」那半
    // 里露面的三条纳进去，`spare` 留在目录里当「还能加的」。
    brief = await radarJson<{ id: string }>(
      environment, ["brief", "create", "--name", "Demand Radar"], "关注开发者的痛点。",
    );
    for (const endpointId of ["ok", "broken", "pushed"]) {
      await radar(environment, ["sources", "include", endpointId, "--brief", brief.id]);
    }
    // `broken` 指着一个 404 的地址，催一次采集把「最近失败」做出来。
    await radar(environment, ["collect"]);
  });

  test.afterAll(async () => {
    await stopRadar(radarProcess);
    await feed.close();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const page = async (): Promise<string> => {
    const response = await fetch(`${origin}/sources`);
    expect(response.ok).toBeTruthy();
    return response.text();
  };

  test("分成两半：在采的在上，目录里还能加的在下", async () => {
    const text = await page();
    expect(text.indexOf("在采的")).toBeLessThan(text.indexOf("目录里还能加的"));

    // 在采的那半仍是一张清单，内部不按渠道配置状态切块：装好即用在前，
    // 配置后解锁在后，中间没有小标题把它切开（ADR 0013）。
    expect(text.match(/<ul class="sources">/g)).toHaveLength(1);
    const inUse = /<ul class="sources">([\s\S]*?)<\/ul>/.exec(text)![1]!;
    expect(inUse).not.toContain("<h2");
    const order = ["正常的源", "要登录才看得到"].map((name) => inUse.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));

    // 没被任何 Brief 纳入的不在上半——登记着不等于在采（#104）。
    expect(inUse).not.toContain("目录里还摆着的源");
    expect(inUse).not.toContain("够不着的源");
  });

  test("目录里还能加的按 topics 分组折起来，每条一个要选 Brief 的纳入动作", async () => {
    const text = await page();
    const catalog = text.slice(text.indexOf("目录里还能加的"));
    expect(catalog).toContain('<details class="topic-group">');
    expect(catalog).toContain("product");
    expect(catalog).toContain("目录里还摆着的源");
    // 未纳入是来源状态，不是「正常」：Radar 压根没在采它。
    expect(catalog).toContain(">未纳入<");
    // 纳入要选一条 Brief——纳入本来就是 Brief 级的决定。
    expect(catalog).toContain('action="/sources/spare/include"');
    expect(catalog).toContain(`<option value="${brief.id}">Demand Radar</option>`);
    // 够不着的那条没有纳入动作：纳进来也采不到。
    expect(catalog).not.toContain('action="/sources/walled-off/include"');
  });

  test("几种来源状态各自说清楚，够不着的灰着摆在那里", async () => {
    const text = await page();
    expect(text).toContain(">正常<");
    expect(text).toContain(">最近失败<");
    // 最近失败要带错误原因与连续失败次数。
    // 「错误原因」是这一条的一半，兜底那句「没有留下错误原因」不算数。
    expect(text).toMatch(/连续失败 \d+ 次：(?!没有留下)/);
    expect(text).toContain("HTTP 404");
    expect(text).toContain(">等推送<");
    // 「等推送」不是故障，用「最后收到推送」代替「已配置」标志。
    expect(text).toContain("还没有收到过推送。");
    // 够不着的渠道灰着摆在那里，是覆盖缺口的表达，不是藏起来。
    expect(text).toContain("is-unreachable");
    expect(text).toContain("这个渠道 Radar 够不着。");
  });

  test("退役端点显示退役理由，不消失", async () => {
    const text = await page();
    expect(text).toContain("搬走了的源");
    expect(text).toContain("已退役：站点关了，官方 feed 不再更新。");
  });

  test("收到推送之后，「已配置」那一格换成最后收到推送的时间", async () => {
    const pushed = await radar(
      environment,
      ["push", "--endpoint", "pushed"],
      JSON.stringify([{
        externalId: "pushed-1",
        title: "登录之后才看得到的一条",
        originUrl: "https://example.test/pushed/1",
        body: "Agent 采下来推过来的正文。",
      }]),
    );
    expect(pushed.code).toBe(0);

    const text = await page();
    expect(text).not.toContain("还没有收到过推送。");
    expect(text).toMatch(/最后收到推送：\d{4}-\d{2}-\d{2}/);
    // 收到推送不改变它的状态：那个渠道本来就等推送，不是故障也不是「正常」。
    expect(text).toContain(">等推送<");
  });

  // 挑源靠的就是这几个标签（ADR 0018），页面上把它摆出来，但不做成筛选器。
  test("出厂目录给的 topics 摆在页面上", async () => {
    const text = await page();
    expect(text).toContain(">devtools<");
    expect(text).toContain(">systems<");
  });

  test("来自外部来源的文本一律转义", async () => {
    const text = await page();
    // 端点名与退役理由都由第三方写，原样出现在页面上，但作为文本，不是标签。
    expect(text.match(/&lt;script&gt;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain(injected);
  });

  test("页面上两个动作：实例级停用，和把目录里的一条纳入某条 Brief", async () => {
    // `配置后解锁` 与够不着的行没有停用按钮。
    const before = await page();
    const actions = before.match(/<form class="source-action"[\s\S]*?<\/form>/g) ?? [];
    expect(actions).toHaveLength(2); // 在采的那半里，rss 渠道下两条没退役的端点
    expect(actions.join("")).not.toContain("/sources/pushed/");
    expect(actions.join("")).not.toContain("/sources/walled-off/");
    expect(actions.join("")).not.toContain("/sources/gone/");

    // 纳入是页面上真的动作：按下去它就从目录那半挪到在采的那半，Radar 开始采它。
    const included = await fetch(`${origin}/sources/spare/include`, {
      method: "POST",
      headers: { origin },
      body: new URLSearchParams({ briefId: brief.id }),
      redirect: "manual",
    });
    expect(included.status).toBe(303);
    const spare = (await radarJson<Endpoint[]>(environment, ["sources"]))
      .find((endpoint) => endpoint.id === "spare")!;
    expect(spare.includedInBriefs.map((each) => each.briefId)).toEqual([brief.id]);
    expect(spare.status).toBe("normal");
    const afterInclude = await page();
    const inUse = /<ul class="sources">([\s\S]*?)<\/ul>/.exec(afterInclude)![1]!;
    expect(inUse).toContain("目录里还摆着的源");

    // 页面只做纳入这个决定本身，不把纳入的理由摆上来——那是对话里的事。
    await radar(environment, [
      "sources", "include", "ok", "--brief", brief.id, "--reason", "这条线只看它",
    ]);
    expect(await page()).not.toContain("这条线只看它");

    // 停用是页面上另一个真的动作，按下去 Radar 真的不再采它。
    // 浏览器提交同源表单时会带上 Origin，这里照做。
    const stopped = await fetch(`${origin}/sources/ok/enabled`, {
      method: "POST",
      headers: { origin },
      body: new URLSearchParams({ enabled: "false" }),
      redirect: "manual",
    });
    expect(stopped.status).toBe(303);
    const disabled = (await radarJson<Endpoint[]>(environment, ["sources"]))
      .find((endpoint) => endpoint.id === "ok")!;
    expect(disabled.userDisabledAt).not.toBeNull();
    expect(await page()).toContain(">已停用<");

    // 跨站的表单 POST 停不掉来源——服务听在固定端口上，浏览器里任何一个页面
    // 都够得着它。
    const crossSite = await fetch(`${origin}/sources/ok/enabled`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: new URLSearchParams({ enabled: "false" }),
      redirect: "manual",
    });
    expect(crossSite.status).toBe(403);

    // 恢复也在同一处，页面上写的就是当前状态。
    await fetch(`${origin}/sources/ok/enabled`, {
      method: "POST",
      headers: { origin },
      body: new URLSearchParams({ enabled: "true" }),
      redirect: "manual",
    });
    expect(await page()).not.toContain(">已停用<");
  });

  test("服务端渲染，并加载实时同步与复制交互", async () => {
    const text = await page();
    expect(text).toContain('/assets/app.js');
    // 配色与字体沿用 DESIGN.md 那张样式表。
    expect(text).toContain("/assets/styles.css");
  });
});
