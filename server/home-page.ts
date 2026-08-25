import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * Web 上只有这一张页（ADR 0013）。这一版只证明服务与静态资源在任意 cwd
 * 下都立得住；按渠道分组的采集端点清单在 #72 落地。
 *
 * `hono/html` 的插值默认转义——feed 标题与描述由第三方控制，直接拼进模板
 * 字符串就是存储型 XSS。
 */
export function renderHomePage(input: {
  version: string;
  dataDirectory: string;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Radar · 本地信号聚合站</title>
    <link rel="stylesheet" href="/assets/styles.css" />
  </head>
  <body>
    <main id="main-content" class="page">
      <h1>Radar</h1>
      <p class="lede">这台 Radar 正在本机运行，版本 ${input.version}。</p>
      <p class="meta">本地数据目录：<code>${input.dataDirectory}</code></p>
      <p class="meta">采集端点清单还没有落地；现在请用 <code>radar --help</code> 看命令面。</p>
    </main>
  </body>
</html>
`;
}
