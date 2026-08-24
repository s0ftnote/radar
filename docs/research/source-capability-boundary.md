# 需求雷达的来源能力边界

> 研究快照：2026-08-20。本文回答的是“当前机器上的来源网络能可靠做到什么”，不是未来愿望清单。分级依据同时包含本机只读验收和上游一手文档/源码。

## 结论

Radar 已经具备跑通首个需求雷达的来源基础，但还没有“全网全平台”能力：

- **稳定骨干**是原生 RSS/Atom、GitHub 官方 API/`gh`；V2EX 公共 API 可作为补充社区信号源。
- **当前可用但只能实验性纳入**的是 B 站、Reddit、知乎热榜、YouTube、Exa 搜索和通用网页读取。它们有的依赖非官方接口或登录 Cookie，有的只能主动搜索而不能稳定增量订阅，必须逐路由健康检查。
- **当前不可计入覆盖范围**的是 Twitter/X、小红书，以及 RSSHub 的 Reddit。Twitter/X 的凭据“存在”不等于链路可用；小红书缺少已连接的浏览器后端；当前 RSSHub 已没有 Reddit 路由。
- **Hermes 不属于来源网络**。它适合定时触发 Radar Skill、接收 Radar 生成的报告并投递；采集状态、历史、去重和报告不应只存在于 Skill 或 Hermes 会话中。Hermes 官方也将 Skills、Cron 和消息网关描述为不同能力。[Hermes README](https://github.com/NousResearch/hermes-agent#readme)
- 因此 MVP 可以以“RSS + GitHub + B 站 + Reddit + V2EX”为主要候选池，知乎热榜、YouTube、网页搜索作为补充；但应把 Reddit/B 站标成实验来源，并明确告诉用户 X、小红书和知乎定向跟踪尚未形成可靠覆盖。

这里的三个等级含义是：

- **Stable**：当前已实时读到内容，接口/协议相对明确，适合成为 MVP 的默认骨干。
- **Experimental**：当前可能读到内容，但依赖 Cookie、非官方接口、网页结构、已停更后端或逐条内容条件，失败不能让整次 Radar 失败。
- **Unavailable**：当前配置下没有得到可用内容，不能在产品里宣称已覆盖。

## 当前能力矩阵

| 来源/后端 | 当前等级 | 广泛发现 | 人物/公司/项目定向跟踪 | 本机只读验收与边界 |
| --- | --- | --- | --- | --- |
| 原生 RSS/Atom（Agent-Reach / feedparser） | **Stable** | 弱：需要先知道 feed，不是全网索引 | 强：官网、博客、Release、播客等存在稳定 feed 时最合适 | `agent-reach doctor --json` 为 `ok`；实时读取 GitHub Changelog feed 得到 HTTP 200、10 条 entry、无解析错误。Agent-Reach 明确支持任意 RSS/Atom，但它只负责读取，不保存轮询历史。[Agent-Reach v1.5.0 README](https://github.com/Panniantong/Agent-Reach/blob/v1.5.0/README.md#%E6%94%AF%E6%8C%81%E7%9A%84%E5%B9%B3%E5%8F%B0) |
| GitHub 官方 API / `gh` | **Stable** | 强：仓库、Issue、PR、Commit、代码可搜索；仓库搜索支持 topic、owner、language、stars、created/updated 等过滤 | 强：用户、组织、仓库、Release、Issue、PR、Event | `gh` 已认证；仓库搜索实时返回数据；本机 core 限额 5,000/h、search 30/min、code search 10/min。Events 最多 300 条、仅保留 30 天，通常延迟 30 秒至 6 小时，应使用 ETag、`X-Poll-Interval` 和增量游标。[gh search repos](https://cli.github.com/manual/gh_search_repos) · [REST Events](https://docs.github.com/en/rest/activity/events) · [REST 限流](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) · [最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) |
| V2EX 公共 API（Agent-Reach） | **Stable（补充）** | 中：热门、节点主题、回复适合发现中文技术/产品抱怨 | 弱：可按节点持续看；用户接口主要是资料，不是完整用户内容流 | `doctor` 为 `ok`；热门 API 实时 HTTP 200、返回 10 条。公共 API 的主题、节点、回复和用户接口由 V2EX 官方列出。[V2EX API](https://www.v2ex.com/p/7v9TEc53) |
| B 站（Agent-Reach `bili-cli`） | **Experimental，可用** | 强：关键词视频/用户搜索、热门、排行榜、视频详情 | 中：可按 UID 读取 UP 资料与视频列表 | `doctor` 为 `ok`；关键词搜索实时返回内容；“数字生命卡兹克”和“歸藏的AI工具箱”的 UID 搜索及 `user-videos` 均实时成功。但当前 `bili-cli` 上游自 2026-03 起停更，部分定向结果的互动字段不完整；字幕还依赖 OpenCLI。Agent-Reach v1.5.0 也将 B 站读取改为 `bili-cli → OpenCLI → API` 的降级链。[Agent-Reach v1.5.0 发布说明](https://github.com/Panniantong/Agent-Reach/releases/tag/v1.5.0) |
| Reddit（Agent-Reach `rdt-cli`） | **Experimental，当前可用** | 强：关键词、subreddit、popular、帖子和评论 | 中：可按 subreddit、用户主动查询 | OpenCLI 浏览器桥当前未连接，但备用 `rdt-cli` 显示已有登录态；关键词搜索和 `r/startups` 浏览实时返回非空内容。这条链依赖浏览器 Cookie，安装版本为 0.4.1，Agent-Reach 上游把它列为停更的服务器备选，因此不能升为 Stable，也不能作为唯一痛点来源。[Agent-Reach Reddit 说明](https://github.com/Panniantong/Agent-Reach/blob/v1.5.0/README.md#%E6%94%AF%E6%8C%81%E7%9A%84%E5%B9%B3%E5%8F%B0) |
| 知乎（RSSHub） | **Experimental，只有热榜通过** | 中：热榜、日报/周刊、话题；当前没有通用关键词全文搜索路由 | 理论上有人物动态/回答/文章、专栏等路由；当前未通过 | `/zhihu/hot` 实时 HTTP 200；指定人物的 `activities` 和 `answers` 均 503。RSSHub 源码说明未登录时大部分路由无法获取全文，热榜路由也标记 `antiCrawler: true`；当前容器没有 `ZHIHU_COOKIES`。[知乎 namespace](https://github.com/DIYgod/RSSHub/blob/697421be62613f3d1db960f53adb8cd569343a9c/lib/routes/zhihu/namespace.ts) · [热榜 route](https://github.com/DIYgod/RSSHub/blob/697421be62613f3d1db960f53adb8cd569343a9c/lib/routes/zhihu/hot.ts) |
| RSSHub 的 GitHub 路由 | **Mixed** | 部分可用：Trending 缺 token；网页搜索当前 503 | 可用：repo events、issues 实时 HTTP 200 | 当前容器只配置 `NODE_ENV`、`CACHE_TYPE`、`TZ` 等基础变量，没有 `GITHUB_ACCESS_TOKEN`。`/github/issue/...`、`/github/repo_event/...` 可用；Trending 源码强制要求 token。既然本机 `gh` 已认证，Radar 应优先用 GitHub 官方接口，RSSHub 只作 feed 兼容层。[GitHub routes](https://github.com/DIYgod/RSSHub/blob/697421be62613f3d1db960f53adb8cd569343a9c/lib/routes/github/namespace.ts) · [Trending route](https://github.com/DIYgod/RSSHub/blob/697421be62613f3d1db960f53adb8cd569343a9c/lib/routes/github/trending.tsx) |
| RSSHub 的 B 站路由 | **Experimental，当前多数不可用** | 路由层理论支持搜索、热门、排行榜等 | 路由层理论支持 UP 投稿、动态、评论等 | 当前 `/bilibili/vsearch`、`/hot-search`、`/user/video`、`/user/dynamic` 均因容器没有 Playwright 浏览器而 503，ranking 返回上游错误；容器也没有 `BILIBILI_COOKIE_*`。源码明确搜索无 Cookie 时必须启用 Playwright。当前应走已验收的 `bili-cli`，不能把“RSSHub 在运行”误写为“RSSHub 的 B 站路由可用”。[B 站搜索 route](https://github.com/DIYgod/RSSHub/blob/697421be62613f3d1db960f53adb8cd569343a9c/lib/routes/bilibili/vsearch.ts) |
| YouTube（Agent-Reach / `yt-dlp`） | **Experimental（补充）** | 中：搜索和视频元数据实时可用 | 中：可按频道/视频处理，字幕是否存在需逐条确认 | `doctor` 为 `ok`，一次 `ytsearch` 实时返回结果。官方 skill 明确 `doctor` 只验证工具链，不能证明具体视频有字幕；需按 `yt-dlp → OpenCLI → 音频转写` 逐条降级。[Agent-Reach v1.5.0 README](https://github.com/Panniantong/Agent-Reach/blob/v1.5.0/README.md#%E6%94%AF%E6%8C%81%E7%9A%84%E5%B9%B3%E5%8F%B0) |
| Exa 搜索（Agent-Reach / mcporter） | **Experimental（发现助手）** | 强：适合扩大英文技术与网页候选池 | 弱：搜索结果不是稳定对象订阅 | `doctor` 因不启动远端服务只给 warn，但一次实时语义搜索成功返回结果。它适合作为主动发现/补漏，不应被当成可重放的来源 feed。[Agent-Reach 设计理念](https://github.com/Panniantong/Agent-Reach/blob/v1.5.0/README.md#%E8%AE%BE%E8%AE%A1%E7%90%86%E5%BF%B5) |
| Jina Reader（Agent-Reach） | **Experimental（正文补全）** | 无：不是搜索或订阅源 | 弱：给定 URL 后读取正文 | `doctor` 为 `ok`，实时读取公开网页 HTTP 200。它是 enrichment 后端，不应计入来源覆盖数量。[Jina Reader 官方仓库](https://github.com/jina-ai/reader) |
| Twitter/X | **Unavailable** | 当前不可用 | 当前不可用 | Agent-Reach 检出 `twitter-cli` 0.8.5 和已保存凭据，但未实时验证；已知搜索调用 404。RSSHub `/twitter/user/openai` 实时 503，容器没有任何 Twitter 配置。当前 RSSHub 要求 `TWITTER_AUTH_TOKEN` 或第三方/付费开发者 API，不是旧 `TWITTER_COOKIE`；其 Web API 源码还把 401/403/429 作为 token 失效/限流常态处理。按既定决定，不在本票修复。[Twitter namespace](https://github.com/DIYgod/RSSHub/blob/697421be62613f3d1db960f53adb8cd569343a9c/lib/routes/twitter/namespace.ts) · [Web API token handling](https://github.com/DIYgod/RSSHub/blob/697421be62613f3d1db960f53adb8cd569343a9c/lib/routes/twitter/api/web-api/utils.ts) |
| 小红书 | **Unavailable** | 当前不可用 | 当前不可用 | Agent-Reach 检出 OpenCLI 已安装，但没有已连接的浏览器扩展，`active_backend` 为空；当前不能把小红书求助/评论计入需求雷达覆盖。官方能力依赖 OpenCLI 浏览器登录态或手工 Cookie 后端。[Agent-Reach v1.5.0 README](https://github.com/Panniantong/Agent-Reach/blob/v1.5.0/README.md#%E6%94%AF%E6%8C%81%E7%9A%84%E5%B9%B3%E5%8F%B0) |
| RSSHub 的 Reddit | **Unavailable / 不存在** | 无 | 无 | 当前官方 `routes.json` 和当前容器均没有 Reddit namespace，`/reddit/search/AI` 实时 404。Reddit 只能走 Agent-Reach 的登录态后端，不能再写成“RSSHub + Reddit”。[RSSHub 官方路由清单](https://docs.rsshub.app/routes.json) |

## 广泛发现与定向跟踪应该分开声明

同一个平台“能搜”不代表“能长期盯”，反过来也一样。Source Network 应把两种能力独立展示：

| 能力 | 当前能承担的来源 | 当前明显缺口 |
| --- | --- | --- |
| **Discovery：广泛发现新信号和新对象** | GitHub search；B 站搜索/热门；Reddit 搜索与 subreddit；V2EX 热门/节点；知乎热榜；Exa 网页搜索；RSS 中已有的聚合榜单 | 小红书与 X 缺失；知乎没有通用关键词搜索；中文生活消费类痛点覆盖弱；搜索结果可能被 SEO、教程搬运和旧高赞内容占据，必须由漏斗判断时效和证据质量 |
| **Watch：持续跟踪已知人物、公司、项目** | 原生 RSS/Atom；GitHub user/org/repo/release/issue；B 站 UID 的视频列表；Reddit subreddit/user 主动查询 | 知乎人物路由当前失败；X 人物/列表不可用；跨平台对象需要先解析成各平台稳定 ID；部分来源没有游标/ETag，只能轮询并自行去重 |

合理的流转是：Discovery 找到值得持续关注的对象后，将其提升为 Watch；Watch 的新内容也可以进入本期发现候选池。来源适配器只负责取回可追溯的原始候选，不负责判断“趋势”“痛点”或“机会”——这些判断需要 Radar 自己保存跨期历史。

## RSSHub 和 Agent-Reach 在链路中的位置

两者能帮上忙，但都不是 Radar 核心：

- RSSHub 是把已有网站路由转换成 feed 的 **pull adapter network**。它适合固定对象和固定列表的周期拉取，但某个路由是否可用取决于 route、Cookie、Playwright 和上游反爬，不能只看容器是否存活。RSSHub 官方将自己描述为 RSS network；RSSHub Radar 则只是另一个用于发现当前网页 feed 的浏览器扩展。[RSSHub Introduction](https://github.com/DIYgod/RSSHub#introduction)
- Agent-Reach 是 Agent 的 **主动读取与后端路由工具箱**：安装工具、检查可用性、选择后端，让 Agent 直接调用 `gh`、`bili`、`rdt`、`yt-dlp`、feedparser 等。官方设计明确不把这些工具重新包装成统一数据 API。[Agent-Reach 设计理念](https://github.com/Panniantong/Agent-Reach/blob/v1.5.0/README.md#%E8%AE%BE%E8%AE%A1%E7%90%86%E5%BF%B5)
- Radar 核心仍需负责：一次运行要查哪些来源、增量游标、失败隔离、原文/证据归一化、跨源去重、跨期历史、筛选漏斗和报告。
- Hermes Skill 只应调用 Radar 的“运行/取报告/反馈”等能力；Hermes Cron 负责触发，飞书负责交付。否则只有 Skill 时，每次运行都很容易从头搜索，无法知道是否重复、是否升温、上次哪个来源失败。

## 来源能力必须对用户可见

每个来源至少应展示以下事实，而不是只给“已接入”复选框：

1. **支持什么**：Discovery、Watch、正文补全、评论/互动数据分别是否支持。
2. **当前状态**：Stable / Experimental / Unavailable，以及配置是否齐全。
3. **覆盖对象**：已配置的关键词、feed、subreddit、UID、GitHub owner/repo 等稳定标识。
4. **最近运行**：最近成功时间、最近失败原因、最近一次获得多少候选、是否正在使用降级后端。
5. **时效边界**：轮询频率、可回溯窗口、分页/游标位置、配额和预计恢复时间。
6. **风险说明**：是否依赖登录 Cookie、非官方接口、浏览器会话或反爬敏感 route。

这样用户看到的不是“支持 Reddit/B 站”，而是“Reddit 当前通过 Cookie 后端可搜索，但属于 Experimental；B 站搜索正常，RSSHub 路由故障，已降级到 bili-cli”。

## 横向增加来源的准入条件

新来源不应通过在 Skill 中继续堆命令来接入。它至少需要声明并通过以下边界：

- **能力声明**：支持 Discovery、Watch、正文、评论、互动指标中的哪些；输入是 query、URL 还是稳定对象 ID。
- **统一候选输出**：来源、原始 URL、外部 ID、作者/对象、发布时间、正文或摘要、互动指标、抓取时间；原始证据可回查。
- **增量语义**：cursor、ETag、`updated_since` 或明确的轮询窗口；没有增量能力时说明如何去重。
- **健康探针**：不能只探测进程或凭据存在，必须用最小只读请求验证有非空、可解析的数据；route 级而非平台级。
- **失败隔离与降级**：单一来源失败不会阻断本期 Radar；多个后端时记录当前后端和切换原因。
- **配额与凭据边界**：认证方式、限流、Cookie 有效期、重试/退避和数据合规风险可见。

这套准入条件让 RSSHub、Agent-Reach、官方 API 和未来的新连接器都能平行挂入 Source Network，而不会把 Radar 锁死在任何一个采集工具上。

## MVP 的来源边界决定

首轮需求雷达应按下面的承诺启动：

1. 默认骨干使用 **原生 RSS/Atom + GitHub 官方 API/`gh`**。
2. 将 **B 站 `bili-cli`、Reddit `rdt-cli`、V2EX** 纳入候选池；B 站和 Reddit 标注 Experimental 并允许整源失败。
3. 将 **知乎热榜、YouTube、Exa 和 Jina Reader** 作为发现或正文补全的辅助来源，不宣称完整平台覆盖。
4. **Twitter/X、小红书、知乎人物定向跟踪** 暂不纳入 MVP 的可用承诺；修复或接入后通过同一健康验收再升级。
5. RSSHub 当前先用于已经单路由验收通过的 feed；不把“容器 200”当作平台接入成功。
6. Hermes 负责定时触发与飞书投递；Radar 核心持有 Source Network 状态、历史和报告。

这已经足以验证“用户描述自己想持续知道什么，Radar 能否替他反复找到少而有证据的信号”，同时不把尚未稳定的平台包装成全网能力。
