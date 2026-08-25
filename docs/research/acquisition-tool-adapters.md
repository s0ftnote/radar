# 现成采集工具能为 Radar 渠道适配器提供什么

> 决策票：[查清现成采集工具能为 Radar 渠道适配器提供什么](https://github.com/s0ftnote/radar/issues/39)（地图 [#37](https://github.com/s0ftnote/radar/issues/37)）
>
> 研究快照：2026-08-25。只引用各项目的 README、文档、源码，以及 AIHOT 官网及其 Skill/API/OpenAPI/使用规则页；仓库链接尽量固定到当日默认分支的提交。RSSHub 路由健康和 Agent-Reach 各后端的本机验收已由 [来源能力边界](source-capability-boundary.md) 覆盖，本文不重复，只补“作为渠道适配器时的调用形态、输入输出、增量、限额和许可”这些缺口。

## 结论

六个目标全部存在，但它们对 Radar 的角色完全不同，不能一概当成“渠道”：

| 工具 | 实际是什么 | 对 Radar 的可用形态 | 出厂默认渠道判定 |
| --- | --- | --- | --- |
| Agent-Reach | 安装/体检/路由的能力层，不提供统一读取 API | 只作 `doctor --json` 健康探针；读取仍由 Radar 直接调用 `gh`、`bili`、feedparser 等上游工具 | **否**（作探针可以，作渠道不行） |
| RSSHub + RSSHub-Radar 规则 | RSSHub 是 feed 适配网络；Radar 规则是随每条路由声明的“网址路径 → RSSHub 路径”映射，由 RSSHub 实例 `/api/radar/rules` 以纯 JSON 输出 | 可离开浏览器扩展复用：拿 JSON 规则 + 约 150 行匹配逻辑即可做“粘网址 → 候选 RSSHub feed”；feed 本身是否可用仍需逐路由验收 | **是**（作为“发现 feed”的规则库；feed 读取按已有 Stable/Experimental 分级） |
| AIHOT | 匿名只读的 AI 行业编辑成品：REST v1、MCP、RSS、`snapshot + changes` | 可作一个带 ETag/游标增量语义的成品上游 | **有条件是**：个人/组织内部免费；面向外部的商业产品、镜像、再分发须书面授权，MVP 不能把它写成不可替换的默认底座 |
| last30days-cn | 中文 8 平台“最近 N 天关键词调研”的一次性 Skill/CLI | 可作 Discovery 型渠道：关键词 → 打分的 JSON 结果 | **否**（作可选实验渠道）：依赖 Playwright/公开接口/Bing 兜底，无增量语义，README 自称“严禁商业用途” |
| follow-builders | 由作者中心化生成的三份 JSON feed + 一份 34 条来源清单 | 来源清单可直接复用为“AI builders 出厂订阅包”；feed 只是 24h/72h/14d 滚动窗口快照 | **清单是，feed 否**：仓库无 LICENSE 文件，复用清单前须确认许可 |
| Horizon | 本地运行的 AI 新闻雷达（抓取→去重→评分→富化→双语简报→分发），MIT | 与 Radar 同类而非上游；其 `scrapers/`（`fetch(since)` 接口）和 `presets.json`（8 领域 30 来源）是可借鉴的 prior art | **否**（不是渠道，是同类产品） |

因此，出厂来源目录应由三层组成：**原生 RSS/Atom + GitHub 官方 API** 做骨干（已有结论）；**RSSHub Radar 规则库**负责“用户粘网址时自动给出可订阅 feed”；**AIHOT**、**follow-builders 清单**作为带许可标注的可选出厂包；last30days-cn 只作实验性 Discovery 渠道；Agent-Reach 只在健康面板里出现。

## 1. Agent-Reach（Panniantong/Agent-Reach）

- **调用形态**：Python CLI，本机 v1.5.0（2026-06-11 发布，之后 main 上只有安全修补和 README 变更）。子命令为 `setup / install / configure / doctor / uninstall / skill / format / transcribe / check-update / watch / version`，没有 `read`、`search`、`fetch` 之类的读取命令。[cli.py](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/cli.py) · [Releases](https://github.com/Panniantong/Agent-Reach/releases)
- README 明确“Agent Reach 是一个能力层，不是又一个工具……负责选型、安装、体检、路由，不负责底层读取本身。读取由 Agent 直接调用上游工具完成，没有包装层”。[README 设计理念](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/README.md#%E8%AE%BE%E8%AE%A1%E7%90%86%E5%BF%B5)
- **输入/输出**：`agent-reach doctor --json` 返回一个以平台为键的对象，每项含 `status`（ok/warn/off/error）、`name`、`message`、`tier`、`backends`、`active_backend`。本机实测 GitHub、Twitter 均为 `warn` 且 `active_backend: null`，消息说明 doctor 刻意不执行会写 device-id 或读浏览器 Cookie 的验证。真正的内容读取要按 SKILL.md 里的路由表直接调 `gh search`、`bili search`、`rdt`、`opencli`、`yt-dlp`、`curl r.jina.ai`、`feedparser`。[SKILL.md](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/skill/SKILL.md)
- `format` 子命令只支持 `xhs` 一个平台；MCP server 只暴露一个 `get_status` 工具（即 doctor 报告），不提供任何读取工具。[cli.py](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/cli.py) · [mcp_server.py](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/integrations/mcp_server.py)
- **RSS 渠道**只检查 `feedparser` 能否 import，`can_handle` 按 URL 含 `/feed`、`/rss`、`.xml`、`atom` 判断；官方示例就是一段 `feedparser.parse(FEED_URL).entries[:5]`。没有 ETag/Last-Modified、没有轮询历史。[channels/rss.py](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/channels/rss.py) · [references/web.md](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/skill/references/web.md)
- **登录态/Key**：README 平台表列出零配置 6 渠道（网页、YouTube、RSS、GitHub 公开读、B 站搜索、V2EX），Twitter/Reddit/小红书/Facebook/Instagram 需要 Cookie 或 OpenCLI 浏览器登录态；Cookie 存 `~/.agent-reach/config.yaml`（600）。README 同时提醒 Cookie 平台“存在被平台检测并封号的风险，请务必使用专用小号”。[README 支持的平台](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/README.md#%E6%94%AF%E6%8C%81%E7%9A%84%E5%B9%B3%E5%8F%B0)
- **增量语义**：无。各上游 CLI 各自决定分页与限额；Agent-Reach 不记录任何拉取状态。
- **许可**：MIT。[LICENSE](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/LICENSE)
- **判定**：不适合包成渠道。Radar 应直接以 `gh`、`bili`、`rdt`、`feedparser` 等上游为渠道实现，把 `agent-reach doctor --json` 用作 Source Network 健康面板的一个探针输入（而且要知道它对登录态平台只给 `warn`，不能替代 route 级只读验收）。

## 2. RSSHub 与 RSSHub-Radar 规则（DIYgod/RSSHub、DIYgod/RSSHub-Radar）

问题核心是：Radar 规则能否脱离浏览器扩展，用来做“粘网址 → 发现 RSSHub 路由/feed”。答案是**可以**，且规则的权威来源是 RSSHub 实例本身，不是扩展。

### 规则在哪里、长什么样

- 每条 RSSHub 路由的 `Route` 对象带可选 `radar?: RadarItem[]`；`RadarItem = { title?, docs?, source: string[], target?: string | function }`。类型注释明确“`target` 用函数的写法自 RSSHub-Radar 2.0.19 起废弃”。[lib/types.ts](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/lib/types.ts)
- 官方路由文档的说明：`source` 是不含协议的 URL 路径数组，访问 `https://github.com/DIYgod/RSSHub` 会匹配 `github.com/:user/:repo` 得到 `{ user: 'DIYgod', repo: 'RSSHub' }`；`target` 用这些参数替换 `:user`/`:repo` 生成 `/github/issue/DIYgod/RSSHub`。文档还写明 radar 字段服务于“RSSHub Radar 或其他兼容其格式的软件”。[rsshub-docs start-code.md](https://github.com/RSSNext/rsshub-docs/blob/main/src/joinus/new-rss/start-code.md)（旧地址 `docs.rsshub.app/joinus/new-radar` 当前 403/404，规则说明已并入 start-code 页）
- 示例：GitHub Issues 路由声明 `source: ['github.com/:user/:repo/issues', 'github.com/:user/:repo/issues/:id', 'github.com/:user/:repo']`，`target: '/issue/:user/:repo'`。[routes/github/issue.ts](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/lib/routes/github/issue.ts)

### 规则如何被导出成机器可读 JSON

- RSSHub 内置 API `GET /api/radar/rules`（全部，按域名分组）和 `GET /api/radar/rules/{domain}`，同时暴露在 `/api/openapi.json` 与 `/api/reference`。[lib/api/index.ts](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/lib/api/index.ts) · [rules/all.ts](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/lib/api/radar/rules/all.ts) · [rules/one.ts](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/lib/api/radar/rules/one.ts)
- 生成逻辑：遍历所有 namespace/route，用 `tldts` 解析 `source[0]` 的域名与子域名，输出 `{ [domain]: { _name, [subdomain]: [{ title, docs, source: [路径], target: '/namespace' + target }] } }`；`target` 缺省回落到路由自身 path。输出只含字符串，不含函数。[rules/utils.ts](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/lib/api/radar/rules/utils.ts)
- 本机验证（2026-08-25）：本地 RSSHub 实例 `http://localhost:1200/api/radar/rules` 返回 HTTP 200、887 KB JSON，共 1,364 个域名、5,508 条规则；`github.com`、`v2ex.com`、`x.com`、`xiaohongshu.com`、`zhihu.com` 均有条目。公共实例 `https://rsshub.app/api/radar/rules` 返回 403 并提示“rsshub.app 仅供测试，请自建”。因此规则源必须指向自建实例。
- 注意规则质量问题：导出的 JSON 里仍存在把废弃函数型 target 序列化成字符串的脏条目（如 `81.cn` 的 `target: "/81params=>{...}"`），消费方需要过滤 `target` 不是以 `/` 开头的合法路径的规则。

### 扩展里的匹配逻辑可以直接搬出来

- 扩展的规则来源就是 `${rsshubDomain}/api/radar/rules`（支持 `?key=` 或 `?code=md5(path+accessKey)` 的访问控制），定时刷新后存本地；仓库内 `src/lib/radar-rules.ts` 只是 1.1 MB 的内置快照（最近一次同步 2026-02-11）。[lib/utils.ts getRadarRulesUrl](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/src/lib/utils.ts) · [lib/rules.ts](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/src/lib/rules.ts) · [background/rules.ts](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/src/background/rules.ts)
- 匹配函数 `getPageRSSHub({ url, html, rules })` 是纯函数：用 `tldts` 取 domain/subdomain 选规则组，对每条 `source` 用 `route-recognizer` 做路径匹配（手工处理可选段与尾部截断），再把参数填进 `target`；返回 `{ title, url: '{rsshubDomain}' + path, path }`。`html` 参数实际未使用。`getWebsiteRSSHub` 则列出该域名全部规则的文档链接。整个文件约 250 行，依赖只有 `route-recognizer`、`tldts`、`lodash`。[lib/rsshub.ts](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/src/lib/rsshub.ts) · [package.json](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/package.json)
- 扩展另一个能力是页面内 `<link rel="alternate" type="application/rss+xml|atom+xml|rdf+xml">` 的原生 feed 自动发现，这部分依赖 `document`，需要 Radar 自己用 HTTP 抓页面 head 重写，逻辑同样简单。[lib/rss.ts](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/src/lib/rss.ts)
- 没有找到官方发布的 npm 包封装这段匹配逻辑；RSSNext/Folo 仓库中也搜不到对 `radar/rules` 的引用（GitHub code search 0 结果）。

### 输入、输出、登录态、增量、限额、许可

- **输入**：任意网页 URL（Radar 用户粘的链接）；**输出**：0..n 条候选 `{ title, rsshubPath }`，加上原生 feed 自动发现结果。
- **登录态/Key**：规则导出与匹配本身不需要；但生成出来的 feed 是否能读，取决于该路由的 Cookie/Playwright/Token 要求（见 [来源能力边界](source-capability-boundary.md) 的 RSSHub 各行）。
- **增量语义**：规则层无需增量，定期整份刷新即可（扩展默认按 `refreshTimeout` 周期刷新）；feed 层按普通 RSS 处理。
- **限额**：自建实例无限额；`rsshub.app` 公共实例已对 API 返回 403。
- **许可**：RSSHub 与 RSSHub-Radar 均为 AGPL-3.0。Radar 若把 `rsshub.ts` 的匹配代码直接复制进仓库，会把该文件置于 AGPL 之下；改为“调用自建 RSSHub 的 `/api/radar/rules` 拿数据 + 自行按文档语义实现匹配”则只消费数据，不继承代码许可。[RSSHub LICENSE](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/LICENSE) · [RSSHub-Radar README](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/README.md)
- **判定**：适合作为出厂默认的“粘网址 → 候选 feed”规则库。实现路径：Radar 从已运行的自建 RSSHub 定时拉 `/api/radar/rules`，用 `route-recognizer`/`tldts` 同类能力自写匹配，把候选 feed 交给已有的 route 级健康验收后才计入订阅。

## 3. AIHOT（aihot.virxact.com）

产品定位差异已在 [Radar 与 AIHOT 的产品差异](radar-vs-aihot.md) 中界定；这里只补作为渠道适配器需要的技术合同与授权边界。

- **调用形态**（四条匿名只读轨道，均无需 API Key）：REST `https://aihot.virxact.com/api/v1/*`（OpenAPI 3.1 `openapi-v1.json`，当前 API 版本 1.2.0）；远程 MCP `https://aihot.virxact.com/api/mcp`，工具为 `aihot_get_latest`、`aihot_search`、`aihot_get_hot_topics`、`aihot_get_story`、`aihot_get_daily`；RSS `feed.xml`（精选 50 条）、`feed/full.xml`（精选全文，仅允许再分发的来源内联正文）、`feed/all.xml`（7 天公开池）、`feed/daily.xml`（日报 30 期）、`feed/category/{ai-models|ai-products|industry|paper|tip}.xml`；以及安装到 `~/.agents/skills/aihot` 的 Skill 1.5.4。[Agent 接入](https://aihot.virxact.com/agent) · [OpenAPI](https://aihot.virxact.com/openapi-v1.json) · [Skill README](https://aihot.virxact.com/aihot-skill/README.md)
- **输入**：`GET /api/v1/items` 接受 `mode=selected|all`、`window=24h|7d`、`by=timeline|published`、`category`、`q`（2–200 字服务端搜索）、`limit`（1–100）、`cursor`。热点 `/hot-topics` 最多 Top 10；事件 `/stories/{publicId}`；日报 `/dailies`、`/dailies/{date}`。[api.md](https://aihot.virxact.com/aihot-skill/references/api.md)
- **输出结构**：item 必有 `id, title, originalTitle, summary, source.name, links.aihot, links.original, publishedAt, discoveredAt, category, score, selected, reason`（其中六个可为 `null`）；外层 `{schemaVersion, query, items, page:{count, hasMore, nextCursor}}`。**没有** `/items/{id}` 单篇正文端点。本机实测 `?mode=selected&window=24h&limit=2` 返回 HTTP 200，字段与文档一致。[api.md](https://aihot.virxact.com/aihot-skill/references/api.md)
- **增量语义**：两套。(1) items 分页 cursor 是不透明书签，滚动窗口，不是一致性快照；(2) 精选私有副本用 `GET /api/v1/selected/snapshot?fields=minimal|default&limit≤1000` 分页 bootstrap（`cursor` 是逐页恒定的同步水位，`nextPage` 只用于翻页，两者不能混用），之后只轮询 `GET /api/v1/selected/changes?cursor=…` 应用 `upsert/remove`；`409 snapshot_required` 时整体重建。所有端点支持 ETag/`If-None-Match`，本机实测二次请求返回 304。文档明确没有 SSE/webhook 推送。[sync.md](https://aihot.virxact.com/aihot-skill/references/sync.md) · [OpenAPI info.description](https://aihot.virxact.com/openapi-v1.json)
- **速率与限额**：未公布每分钟/每 IP 的硬数字。合同是：以响应 `Cache-Control: s-maxage` 为最小轮询间隔（items 60 s、hot-topics 300 s，本机实测 items 响应头为 `public, max-age=60, s-maxage=60, stale-while-revalidate=300`）；RSS 建议 ≥30 分钟；changes 轮询 ≥60 s；429/503 带 `Retry-After`，无该头时等 60 s，不得增加并发；CDN 层可能返回 566/567。[errors.md](https://aihot.virxact.com/aihot-skill/references/errors.md) · [Agent 接入 API 页](https://aihot.virxact.com/agent?tab=api)
- **身份**：可选的 `aihot-actor/<uuid-v4>` 追加到 User-Agent，官方说明“不是认证、授权、配额 key 或限流豁免”。[OpenAPI info.description](https://aihot.virxact.com/openapi-v1.json)
- **授权/商业限制**：个人非商业、公益非商业、组织内部使用免费，并允许“为了实现允许的用途进行必要的缓存和同步”；“任何面向外部的商业产品、收费服务、客户交付、代理接口、数据转售、公开镜像、白标、批量公开再分发，或面向外部的训练、微调、评测、检索增强生成和答案产品，都须事先取得 AIHOT 书面授权。仅标注「数据来源：AIHOT」不代表已取得授权”。MIT 只覆盖 Skill 文件。联系 `wzglyay@virxact.com`。[公开使用规则](https://aihot.virxact.com/terms) · [SKILL.md](https://aihot.virxact.com/aihot-skill/SKILL.md)
- **判定**：作为渠道，AIHOT 是这六个里合同最完整的（分页、ETag、快照+变更、Problem JSON）。对 Radar 这类开源本地优先工具，用户自己运行属于“个人/组织内部使用”，可以做成出厂可选渠道；但 Radar 若以托管服务或商业产品形态对外提供 AIHOT 内容，就落入需书面授权的范围。所以 AIHOT 应标为“可选、需用户知晓授权边界、可替换”的上游，不能是默认唯一底座；且只覆盖 AI 行业，不承担需求痛点证据。

## 4. last30days-cn（Jesseovo/last30days-skill-cn）

- **是什么**：mvanhorn/last30days-skill 的中文本土化 fork，当前 v3.2.0，“自动搜索中国互联网 8 大主流平台最近 30 天的内容，综合分析后生成有据可查的研究报告”。平台：微博、小红书、B 站、知乎、抖音、微信公众号、百度、头条。[README](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/README.md)
- **调用形态**：Agent Skill（`npx skills add Jesseovo/last30days-skill-cn -g`，或克隆到 `~/.claude/skills`），运行载荷是单入口 CLI `python scripts/last30days.py "<关键词>"`。参数：`--emit compact|json|md|context|path|html|html-path`、`--quick/--deep`、`--days N`、`--as-of YYYY-MM-DD`、`--search weibo,bilibili,...`、`--diagnose`、`--save-dir`、`--timeout`。[README 使用方式](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/README.md#-%E4%BD%BF%E7%94%A8%E6%96%B9%E5%BC%8F)
- **输入**：关键词 + 回溯天数；不是账号或 URL 订阅。
- **输出结构**：`scripts/lib/schema.py` 按平台定义 dataclass（如 `WeiboItem`：`id, text, url, author_handle, author_id, date, date_confidence, engagement, relevance, why_relevant, subs{relevance,recency,engagement}, score, cross_refs`；`XiaohongshuItem` 增加 `title, desc, hashtags`），`Engagement` 统一了 likes/reposts/replies/views/collects/danmaku/voteups 等字段；`--emit json` 输出这些结构。[schema.py](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/scripts/lib/schema.py)
- **登录态/Key**：三级降级“API（可选 Key）→ Playwright 爬虫（可选安装）→ 公开接口 → Bing site: 搜索兜底”。微信公众号只有 `WECHAT_API_KEY`（第三方服务商）或搜狗；抖音/头条原生接口需签名“常被风控”，兜底“只能拿到公开链接，无真实互动数据与精确日期”；知乎可选 `ZHIHU_COOKIE`。爬虫模式支持 Cookie 登录态缓存。[README 平台支持/数据获取策略](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/README.md#-%E6%95%B0%E6%8D%AE%E8%8E%B7%E5%8F%96%E7%AD%96%E7%95%A5%E4%B8%89%E7%BA%A7%E9%99%8D%E7%BA%A7)
- **增量语义**：无游标。每次按 `topic|from_date|to_date|sources` 生成缓存 key，默认 TTL 24 小时；`--as-of` 可回放历史窗口。跨期去重要由调用方做。[cache.py](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/scripts/lib/cache.py)
- **速率**：README 建议“每次搜索间隔 ≥ 5 秒”，统一了 HTTP 重试退避与 `Retry-After` 解析。[README v3.1.0](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/README.md)
- **许可与合规**：LICENSE 文件是 MIT（双署名原作者与 fork 作者），但 README 免责声明写“本项目仅供学习和研究目的……严禁用于商业用途”“禁止……对外提供自动化数据采集服务”，并要求遵守各平台 ToS 与 robots.txt。两者并存，Radar 若集成须按更严的一方处理。[LICENSE](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/LICENSE) · [README 免责声明](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/README.md#%EF%B8%8F-%E5%85%8D%E8%B4%A3%E5%A3%B0%E6%98%8E--disclaimer)
- **判定**：不适合作出厂默认渠道。它是一次性 Discovery 调研器（关键词 → 一份报告），无 Watch/增量能力，多平台依赖非官方接口、Playwright 与搜索引擎兜底，且作者自限非商业。可作“中文平台关键词发现”的实验渠道，用 `--emit json` 接入并按 [来源能力边界](source-capability-boundary.md) 的准入条件逐平台标 Experimental。

## 5. follow-builders（zarazhangrui/follow-builders）

- **是什么**：一个 Skill，“monitors top AI builders on X and YouTube podcasts, remixes their content into digestible summaries”。内容由作者的 GitHub Actions 每天 06:17 UTC 集中抓取后提交到仓库，用户端只 `fetch` 三个 raw JSON，“No API keys needed — all content is fetched centrally”。[README](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/README.md) · [generate-feed.yml](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/.github/workflows/generate-feed.yml)
- **来源清单及格式**：`config/default-sources.json`，三个数组：`podcasts`（6 条，含 `name, rssUrl, url`，rssUrl 为 megaphone/simplecast/anchor 等播客 RSS，其中 Latent Space 走 `pod2txt.vercel.app/api/feed?url=` 代理）、`blogs`（2 条：Anthropic Engineering、Claude Blog，`type: scrape` + `indexUrl/articleBaseUrl/fetchMethod`）、`x_accounts`（26 条 `{name, handle}`）。合计 34 个来源。[default-sources.json](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/config/default-sources.json)
- **feed 结构**：`feed-x.json`（`lookbackHours: 24`，每账号 `tweets[]` 含 `id, text, createdAt, url, likes, retweets, replies, isQuote, quotedTweetId`）、`feed-podcasts.json`（`lookbackHours: 336`，含 transcript）、`feed-blogs.json`（`lookbackHours: 72`，含 `content` 全文）。`state-feed.json` 是服务端 `seenTweets` 去重表。用户端 `prepare-digest.js` 固定从 `raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-*.json` 拉取。[prepare-digest.js](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/scripts/prepare-digest.js) · [feed-x.json](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/feed-x.json)
- **上游依赖**：集中抓取端用 X 官方 API v2（`X_BEARER_TOKEN`，每账号 `max_results=5`）和 pod2txt（`POD2TXT_API_KEY`）转写；YouTube 频道/播放列表通过 `youtube.com/feeds/videos.xml` 读取。2026-08-24 的 `feed-podcasts.json` 为空且带 `errors`（pod2txt 404），说明该 feed 单点依赖作者的密钥与第三方服务。[generate-feed.js](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/scripts/generate-feed.js) · [feed-podcasts.json](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/feed-podcasts.json)
- **增量语义**：无游标；每份 feed 是滚动窗口快照（24h/72h/14d），Radar 需按 `id`/`url` 自行去重。
- **登录态/Key**：读取 feed 不需要；Telegram/Resend 只用于投递。
- **许可**：README 与 SKILL 写 “License: MIT”，但仓库默认分支**没有 LICENSE 文件**，GitHub API 的 `license` 为 `null`。默认来源清单是否可再分发没有明确声明。[README License](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/README.md#license)
- **判定**：feed 不适合作出厂渠道（作者单点、无增量、X 内容依赖其 bearer token）。来源清单可作为“AI builders 出厂订阅包”的候选：其中 6 个播客 RSS 和 2 个博客 URL 可以直接进 Radar 原生 RSS/网页渠道；26 个 X 账号只是 handle，Radar 当前 X 链路仍是 Unavailable。复用清单前应向作者确认许可或只引用而不拷贝。

## 6. Horizon（Thysrael/Horizon）

- **是什么**：存在，且相当活跃（9k+ star，2026-08-25 仍有提交）。自述“Your own AI-powered news radar. Generates daily briefings in English & Chinese”，Python/uv，MIT。流水线：Fetch → Deduplicate → AI Score & Filter → Enrich → Summarize → 分发到 GitHub Pages / Email / Feishu、DingTalk、Slack、Discord webhook / MCP。[README](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/README.md) · [pyproject.toml](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/pyproject.toml)
- **调用形态**：CLI `uv run horizon --hours N`；`horizon-wizard` 按兴趣生成 `data/config.json`；`horizon-mcp` 暴露 `hz_fetch_items / hz_score_items / hz_filter_items / hz_enrich_items / hz_generate_summary / hz_run_pipeline / hz_list_runs / hz_get_run_stage …` 等分阶段工具，运行产物写到 `data/mcp-runs/<run_id>/{raw,scored,filtered,enriched}_items.json`。[src/mcp/README.md](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/src/mcp/README.md)
- **输入**：JSON 配置声明来源：Hacker News、RSS/Atom、Reddit（subreddit + user）、Telegram 公开频道、Twitter/X 指定用户、GitHub user events / repo releases、OpenBB；代码里还有 gdelt、google_news、ossinsight scraper。[config.example.json](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/data/config.example.json) · [scrapers/](https://github.com/Thysrael/Horizon/tree/36dcca0f0d224d56802f2991298f0b852e788b36/src/scrapers)
- **输出结构**：统一 `ContentItem { id: "{source}:{subtype}:{native_id}", source_type, title, url, content, author, published_at, fetched_at, metadata, profile, processing }`，处理后附 `ContentAnalysis { score 0–10, reason, summary, tags }` 与多语 `ContentArtifact`。[models.py](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/src/models.py)
- **增量语义**：每个 scraper 实现 `async fetch(since: datetime)`，`since = now − time_window_hours`（默认 24）；跨源按 URL 归一化键和 AI 话题去重。没有跨运行的已见条目存储，同一条目在窗口内重复运行会再次出现。[scrapers/base.py](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/src/scrapers/base.py) · [orchestrator.py](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/src/orchestrator.py)
- **登录态/Key**：LLM 需要 `api_key_env`；GitHub 可选 `GITHUB_TOKEN`（60 → 5000 req/h）；Reddit 走 `old.reddit.com` HTML 与 `.json/.rss` 无 Key 兜底并处理 429 `Retry-After`；Twitter 需 Apify token（`altimis~scweet` actor）或 Playwright + 导出 Cookie。[docs/scrapers.md](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/docs/scrapers.md)
- **来源清单**：`data/presets.json` 8 个领域（ai-ml、systems、security、webdev、pl、embedded、devtools、science）共 30 个来源（12 subreddit、12 RSS、4 GitHub repo、2 GitHub user），每条带中英描述与 tags。[presets.json](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/data/presets.json)
- **判定**：不是渠道，是与 Radar 同一层的竞品/同类。可复用的是 prior art：`fetch(since)` 的 scraper 接口、`{source}:{subtype}:{native_id}` 的 ID 约定、URL 归一化去重、以及 presets 的“领域 → 来源 → tags”组织方式。其 Reddit 无 Key HTML 抓取路线也是 Radar Reddit 渠道的一个备选后端。MIT 允许借鉴与复用代码。

## 对 Radar 渠道适配器与出厂目录的建议

1. **渠道实现直接对上游**：`gh`、feedparser、`bili`、`rdt`、V2EX 公共 API 各自成渠道，Agent-Reach 只贡献 `doctor --json` 到健康面板。
2. **出厂自带“粘网址发现”**：从自建 RSSHub 拉 `/api/radar/rules`（过滤掉 `target` 不合法的脏规则），配合 HTML `<link rel=alternate>` 自动发现，生成候选 feed；候选须通过 route 级只读验收才成为订阅。匹配逻辑自写以避免继承 AGPL。
3. **出厂目录按许可分层**：
   - 骨干：原生 RSS/Atom、GitHub 官方 API（既有决定）。
   - 可选成品上游：AIHOT（标注“个人/组织内部免费，对外商业须授权”，用 `snapshot + changes` 与 ETag）。
   - 可选订阅包：follow-builders 的 6 播客 RSS + 2 博客（先确认许可）；Horizon presets 的 RSS/GitHub 条目（MIT）。
   - 实验渠道：last30days-cn 关键词发现（非商业、无增量、逐平台 Experimental）。
4. **不要把 Horizon 当渠道**，但在设计 scraper 接口与去重键时对照它。

## 未能确认

- RSSHub 官方文档站 `docs.rsshub.app/joinus/new-radar` 当前对本机 curl 返回 403、对抓取工具返回 404，规则说明只在 rsshub-docs 仓库的 `start-code.md` 中找到；无法确认是否还有单独的 Radar 规则页。
- 未找到任何官方或第三方 npm 包把 RSSHub-Radar 的 `getPageRSSHub` 匹配逻辑独立发布；GitHub code search 在 RSSNext/Folo 中也未检到对 `radar/rules` 的引用，Folo 是否在浏览器外消费该规则未能确认。
- AIHOT 没有公布每分钟/每 IP/每 Actor 的硬性配额数字，只给出 `s-maxage`、`Retry-After` 和 RSS ≥30 分钟的行为合同；CDN 层 566/567 的触发条件未公开。
- AIHOT MCP 端点 `api/mcp` 的工具列表来自接入页描述，未实际发起 MCP 会话验证参数 schema。
- follow-builders 仓库无 LICENSE 文件，README 声称 MIT；来源清单是否允许再分发未向作者确认。
- last30days-cn 的 LICENSE 为 MIT 而 README 声明“严禁商业用途”，两者优先级未由作者澄清。
- Horizon 是否有跨运行的 seen 状态：在 `src/orchestrator.py`、`src/storage/manager.py` 中未找到，但未逐行阅读 `src/mcp/run_store.py`，MCP 运行产物是否被用于去重未确认。
- Agent-Reach main 分支自 v1.5.0 之后的提交（截至 2026-08-12）未发新版本，未逐条核对是否改变了 CLI 合同。

## 一手资料索引

### Agent-Reach
- [README（93ae1d1）](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/README.md)
- [cli.py](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/cli.py) · [integrations/mcp_server.py](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/integrations/mcp_server.py) · [channels/rss.py](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/channels/rss.py)
- [skill/SKILL.md](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/skill/SKILL.md) · [skill/references/web.md](https://github.com/Panniantong/Agent-Reach/blob/93ae1d18c37b707dec053c7c4f9d91cd8ef8943d/agent_reach/skill/references/web.md)
- [Releases](https://github.com/Panniantong/Agent-Reach/releases)

### RSSHub / RSSHub-Radar
- [RSSHub lib/types.ts（bff8a52）](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/lib/types.ts) · [lib/api/index.ts](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/lib/api/index.ts) · [lib/api/radar/rules/utils.ts](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/lib/api/radar/rules/utils.ts) · [routes/github/issue.ts](https://github.com/DIYgod/RSSHub/blob/bff8a523e0b57b96931bb7b641ce14529b1242a5/lib/routes/github/issue.ts)
- [rsshub-docs start-code.md](https://github.com/RSSNext/rsshub-docs/blob/main/src/joinus/new-rss/start-code.md)
- [RSSHub-Radar README（ad302d8）](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/README.md) · [src/lib/rsshub.ts](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/src/lib/rsshub.ts) · [src/lib/rules.ts](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/src/lib/rules.ts) · [src/lib/rss.ts](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/src/lib/rss.ts) · [src/lib/types.ts](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/src/lib/types.ts) · [src/background/rules.ts](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/src/background/rules.ts) · [package.json](https://github.com/DIYgod/RSSHub-Radar/blob/ad302d8d3afda7c1087304294b1f475b4a0d5569/package.json)

### AIHOT
- [Agent 接入](https://aihot.virxact.com/agent) · [API 标签页](https://aihot.virxact.com/agent?tab=api)
- [Skill README](https://aihot.virxact.com/aihot-skill/README.md) · [SKILL.md](https://aihot.virxact.com/aihot-skill/SKILL.md) · [references/api.md](https://aihot.virxact.com/aihot-skill/references/api.md) · [references/sync.md](https://aihot.virxact.com/aihot-skill/references/sync.md) · [references/errors.md](https://aihot.virxact.com/aihot-skill/references/errors.md)
- [OpenAPI v1](https://aihot.virxact.com/openapi-v1.json) · [公开使用规则](https://aihot.virxact.com/terms)

### last30days-cn
- [README（1a8a04c）](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/README.md) · [LICENSE](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/LICENSE) · [scripts/lib/schema.py](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/scripts/lib/schema.py) · [scripts/lib/cache.py](https://github.com/Jesseovo/last30days-skill-cn/blob/1a8a04c3c347defbcdbb8da26d7cf1a531426b1f/scripts/lib/cache.py)

### follow-builders
- [README（a0f6f4c）](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/README.md) · [SKILL.md](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/SKILL.md) · [config/default-sources.json](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/config/default-sources.json) · [scripts/generate-feed.js](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/scripts/generate-feed.js) · [scripts/prepare-digest.js](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/scripts/prepare-digest.js) · [.github/workflows/generate-feed.yml](https://github.com/zarazhangrui/follow-builders/blob/a0f6f4cd43f04ed60a99bd4750276cb98b35a88e/.github/workflows/generate-feed.yml)

### Horizon
- [README（36dcca0）](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/README.md) · [pyproject.toml](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/pyproject.toml) · [src/models.py](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/src/models.py) · [src/scrapers/base.py](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/src/scrapers/base.py) · [src/orchestrator.py](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/src/orchestrator.py) · [docs/scrapers.md](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/docs/scrapers.md) · [src/mcp/README.md](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/src/mcp/README.md) · [data/presets.json](https://github.com/Thysrael/Horizon/blob/36dcca0f0d224d56802f2991298f0b852e788b36/data/presets.json)
