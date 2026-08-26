import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fixtureCatalog, startHarness, type Endpoint } from "./support/harness.js";
import { startFeedFixture } from "./support/feed-fixture.js";
import { radar, radarJson, startRadar, stopRadar } from "./support/radar-process.js";

/**
 * 粘一个网址进来，Radar 尽力把它变成一条可订阅的采集端点；实在不行就明说
 * 够不着，不去猜、不去抓 HTML。
 */

type Candidate = { name: string; feedUrl: string; via: string };

/** 一个假站点：一个带 feed 声明的页面、一个不带的、一个假 RSSHub。 */
async function startSite(): Promise<{ url: string; close(): Promise<void> }> {
  const routes: Record<string, { type: string; body: string }> = {
    "/blog": {
      type: "text/html; charset=utf-8",
      body: `<!doctype html><html><head>
        <link rel="alternate" type="application/rss+xml" title="每周更新" href="/blog/feed.xml" />
        <link rel="alternate" type="application/atom+xml" title="评论" href="https://elsewhere.test/atom" />
        <link rel="stylesheet" href="/styles.css" />
      </head><body>正文</body></html>`,
    },
    "/plain": { type: "text/html; charset=utf-8", body: "<!doctype html><html><body>什么都没有</body></html>" },
    "/api/namespace": {
      type: "application/json",
      body: JSON.stringify({
        example: {
          routes: {
            "/example/posts/:user": {
              path: "/posts/:user",
              name: "某人的帖子",
              radar: [{ source: ["example.test/u/:user"], target: "/posts/:user" }],
            },
          },
        },
      }),
    },
  };

  const server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0]!;
    // 一个公开页面把你弹进内网——这一跳照样得复核。
    if (path === "/to-private") {
      return void response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
    }
    // 恶意 feed 不能把服务拖死：不报 content-length，一直吐。
    if (path === "/endless") {
      response.writeHead(200, { "content-type": "text/html" });
      const chunk = "x".repeat(64 * 1024);
      const pump = () => {
        while (response.write(chunk)) {
          if (response.destroyed) return;
        }
        response.once("drain", pump);
      };
      return void pump();
    }
    const route = routes[path];
    if (!route) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": route.type }).end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("站点没有绑上端口。");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      (server as Server).close((error) => (error ? reject(error) : resolve()))),
  };
}

test.describe("粘网址发现可订阅端点", () => {
  test.describe.configure({ mode: "serial" });

  test("页面自带的 feed 会被找出来；粘进来的本身是 feed 时它就是唯一那条", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("discover", 33199, undefined, true);
    const site = await startSite();
    try {
      const candidates = await radarJson<Candidate[]>(
        harness.environment, ["discover", `${site.url}/blog`],
      );
      expect(candidates.map((candidate) => candidate.feedUrl)).toEqual([
        `${site.url}/blog/feed.xml`,
        "https://elsewhere.test/atom",
      ]);
      expect(candidates[0]!.name).toBe("每周更新");
      expect(candidates.every((candidate) => candidate.via === "page-feed")).toBe(true);

      // 挑中之后它就是一个普通的 RSS/Atom 端点，跟发现这一步彻底脱钩。
      const added = await radarJson<Endpoint>(harness.environment, [
        "sources", "add", "--channel", "rss",
        "--name", candidates[0]!.name, "--url", candidates[0]!.feedUrl,
      ]);
      expect(added.provenance).toBe("user");
      expect(added.url).toBe(`${site.url}/blog/feed.xml`);

      // 粘进来的本身就是一份 feed 时，它自己就是那条候选。
      const feedItself = await radarJson<Candidate[]>(
        harness.environment, ["discover", `${harness.feed.url}/alpha`],
      );
      expect(feedItself).toHaveLength(1);
      expect(feedItself[0]!.feedUrl).toBe(`${harness.feed.url}/alpha`);
    } finally {
      await site.close();
      await harness.dispose();
    }
  });

  test("都不中就明示够不着，不降级去抓 HTML", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("discover-none", 33200, undefined, true);
    const site = await startSite();
    try {
      const run = await radar(harness.environment, ["discover", `${site.url}/plain`]);
      expect(run.code).not.toBe(0);
      expect(run.stderr).toContain("没有找到可订阅的 feed");
      expect(run.stderr).toContain("不会去抓 HTML");
      // 没有候选就是没有候选，不会凭空造一条端点出来。
      expect(await radarJson<Endpoint[]>(harness.environment, ["sources"]))
        .toHaveLength(2);
    } finally {
      await site.close();
      await harness.dispose();
    }
  });

  test("RSSHub 只是一份规则：没填地址就跳过，填了才给候选，规则每天从你那台刷新", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("discover-rsshub", 33201, undefined, true);
    const site = await startSite();
    try {
      // 没填地址：这一步整个跳过，Radar 不替你找一台公共实例。
      expect(await radarJson<{ baseUrl: string | null }>(harness.environment, ["rsshub", "show"]))
        .toEqual({ baseUrl: null });
      const before = await radar(harness.environment, ["discover", "https://github.com/hono/hono"]);
      expect(JSON.parse(before.stdout).every((candidate: Candidate) => candidate.via !== "rsshub"))
        .toBe(true);

      // 填上地址、但那台实例刷不下来规则时，用随版本来的那份快照，不是失败。
      await radar(harness.environment, ["rsshub", "set", "http://127.0.0.1:1"]);
      const many = await radarJson<Candidate[]>(
        harness.environment, ["discover", "https://github.com/hono/hono"],
      );
      // 同一个主页对上多条路由时给多条候选，由用户挑。
      const shipped = many.filter((candidate) => candidate.via === "rsshub");
      expect(shipped.length).toBeGreaterThan(1);
      expect(shipped.every((candidate) => candidate.feedUrl.startsWith("http://127.0.0.1:1/github/")))
        .toBe(true);

      // 规则每天从用户自己那台刷新，匹配用的就是刷下来那份。
      await radar(harness.environment, ["rsshub", "set", site.url]);
      const matched = await radarJson<Candidate[]>(
        harness.environment, ["discover", "https://example.test/u/somebody"],
      );
      expect(matched).toEqual([
        { name: "某人的帖子", feedUrl: `${site.url}/example/posts/somebody`, via: "rsshub" },
      ]);

      // 清掉又回到跳过：这一步整个不走，那个网址就再没有别的候选了。
      await radar(harness.environment, ["rsshub", "clear"]);
      const cleared = await radar(harness.environment, ["discover", "https://example.test/u/somebody"]);
      expect(cleared.code).not.toBe(0);
      expect(cleared.stderr).toContain("没有找到可订阅的 feed");
    } finally {
      await site.close();
      await harness.dispose();
    }
  });

  test("跟随重定向时逐跳复核；恶意 feed 拖不死服务", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("discover-hops", 33203, undefined, true);
    const site = await startSite();
    try {
      // 第一跳是用户粘的地址，可它把你弹去云元数据端点——那不是用户的决定。
      const redirected = await radar(harness.environment, ["discover", `${site.url}/to-private`]);
      expect(redirected.code).not.toBe(0);
      expect(redirected.stderr).toContain("不去请求 169.254.169.254");

      // 响应体有上限，一直吐的那种在上限处被掐断，服务照样活着。
      const endless = await radar(harness.environment, ["discover", `${site.url}/endless`]);
      expect(endless.code).not.toBe(0);
      expect(await radarJson<Endpoint[]>(harness.environment, ["sources"])).toHaveLength(2);
    } finally {
      await site.close();
      await harness.dispose();
    }
  });

  test("在那一页上粘网址、挑一条、加进来；RSSHub 地址也在那一页上", async () => {
    test.setTimeout(120_000);
    const harness = await startHarness("discover-page", 33204, undefined, true);
    const site = await startSite();
    const origin = `http://127.0.0.1:${harness.radarProcess.port}`;
    const post = (path: string, fields: Record<string, string>) =>
      fetch(`${origin}${path}`, {
        method: "POST",
        headers: { origin },
        body: new URLSearchParams(fields),
        redirect: "manual",
      });
    try {
      // 唯一那处实例级设置就在这一页上。
      expect(await (await fetch(origin)).text()).toContain("你的 RSSHub 地址");
      expect((await post("/settings/rsshub", { baseUrl: site.url })).status).toBe(303);
      expect(await radarJson<{ baseUrl: string }>(harness.environment, ["rsshub", "show"]))
        .toEqual({ baseUrl: site.url });

      // 粘网址 → 候选列在页面上，由用户挑。
      const found = await (await post("/sources/discover", { url: `${site.url}/blog` })).text();
      expect(found).toContain("每周更新");
      expect(found).toContain(`${site.url}/blog/feed.xml`);

      // 挑中之后它就是一条普通端点，回到那张清单里。
      expect((await post("/sources/add", {
        name: "每周更新", url: `${site.url}/blog/feed.xml`,
      })).status).toBe(303);
      const added = (await radarJson<Endpoint[]>(harness.environment, ["sources"]))
        .find((endpoint) => endpoint.name === "每周更新");
      expect(added?.provenance).toBe("user");

      // 加源失败只说一句结果，细节问 Agent（ADR 0013）。
      const failed = await (await post("/sources/discover", { url: `${site.url}/plain` })).text();
      expect(failed).toContain("没有找到可订阅的 feed");
      expect(failed).not.toContain("stack");
    } finally {
      await site.close();
      await harness.dispose();
    }
  });

  test("SSRF：私网、回环、链路本地与云元数据端点一律不请求", async () => {
    test.setTimeout(120_000);
    // 这个实例不用 fixture feed，端点地址不指内网，防护整条都在。
    const dataDirectory = await mkdtemp(join(tmpdir(), "radar-ssrf-"));
    const feed = await startFeedFixture();
    const catalogPath = await fixtureCatalog(dataDirectory, feed);
    const environment = { dataDirectory, catalogPath };
    const radarProcess = await startRadar(dataDirectory, { port: 33202, catalogPath });
    try {
      const blocked = [
        "http://127.0.0.1:5432/",
        "http://localhost:6379/",
        "http://10.0.0.1/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://0.0.0.0/",
      ];
      for (const url of blocked) {
        const run = await radar(environment, ["discover", url]);
        expect(run.code, `${url} 居然请求了`).not.toBe(0);
        expect(run.stderr, url).toContain("不去请求");
      }

      // 不是 http/https 的一律不碰。
      const file = await radar(environment, ["discover", "file:///etc/passwd"]);
      expect(file.code).not.toBe(0);
      expect(file.stderr).toContain("只请求 http 与 https");

      // 网址里带凭据的也不碰——它会随重定向被带走。
      const credentials = await radar(environment, ["discover", "https://user:pass@example.test/"]);
      expect(credentials.code).not.toBe(0);
      expect(credentials.stderr).toContain("不要带用户名密码");
    } finally {
      await stopRadar(radarProcess);
      await feed.close();
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });
});
