import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startFeedFixture, type FeedFixture } from "./support/feed-fixture.js";
import { radar, radarJson, startRadar, stopRadar, type RunningRadar } from "./support/radar-process.js";
import type { Endpoint } from "./support/harness.js";

/**
 * Web 上唯一那张来源页（ADR 0013）：一眼看清这台 Radar 现在够得着什么、
 * 什么坏了、什么在等推送。看归网页，改归对话。
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
        { id: "ok", channelId: "rss", name: "正常的源", url: `${feed.url}/alpha`, licenseBasis: license },
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

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    dataDirectory = await mkdtemp(join(tmpdir(), "radar-page-"));
    feed = await startFeedFixture();
    const catalogPath = await pageCatalog(dataDirectory, feed);
    environment = { dataDirectory, catalogPath };
    radarProcess = await startRadar(dataDirectory, { port: 33198, catalogPath });
    origin = `http://127.0.0.1:${radarProcess.port}`;
    // `broken` 指着一个 404 的地址，催一次采集把「最近失败」做出来。
    await radar(environment, ["collect"]);
  });

  test.afterAll(async () => {
    await stopRadar(radarProcess);
    await feed.close();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const page = async (): Promise<string> => {
    const response = await fetch(origin);
    expect(response.ok).toBeTruthy();
    return response.text();
  };

  test("单一列表按渠道配置状态排序，不分区块", async () => {
    const text = await page();
    // 三档各出现一次，顺序是 装好即用 → 配置后解锁 → 够不着。
    const order = ["正常的源", "要登录才看得到", "够不着的源"].map((name) => text.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));

    // 一张清单，不是三个区块——列表只有一个，中间也没有小标题把它切开。
    expect(text.match(/<ul class="sources">/g)).toHaveLength(1);
    const list = /<ul class="sources">([\s\S]*?)<\/ul>/.exec(text)![1]!;
    expect(list).not.toContain("<h2");
  });

  test("三种来源状态各自说清楚，够不着的灰着摆在那里", async () => {
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

  test("来自外部来源的文本一律转义", async () => {
    const text = await page();
    // 端点名与退役理由都由第三方写，原样出现在页面上，但作为文本，不是标签。
    expect(text.match(/&lt;script&gt;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain(injected);
  });

  test("页面上只有实例级停用一个动作，Brief 级排除不上页面", async () => {
    // `配置后解锁` 与够不着的行没有动作按钮。
    const before = await page();
    const actions = before.match(/<form class="source-action"[\s\S]*?<\/form>/g) ?? [];
    expect(actions).toHaveLength(2); // 只有 rss 渠道下两条没退役的端点
    expect(actions.join("")).not.toContain("/sources/pushed/");
    expect(actions.join("")).not.toContain("/sources/walled-off/");
    expect(actions.join("")).not.toContain("/sources/gone/");

    // Brief 级排除不上页面。
    const brief = await radarJson<{ id: string }>(
      environment, ["brief", "create", "--name", "Demand Radar"], "关注开发者的痛点。",
    );
    await radar(environment, ["sources", "exclude", "ok", "--brief", brief.id, "--reason", "太吵"]);
    expect(await page()).not.toContain("太吵");

    // 停用是页面上真的动作，按下去 Radar 真的不再采它。
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

  test("服务端渲染，不引入 JSX 运行时", async () => {
    const text = await page();
    expect(text).not.toContain("<script");
    // 配色与字体沿用 DESIGN.md 那张样式表。
    expect(text).toContain("/assets/styles.css");
  });
});
