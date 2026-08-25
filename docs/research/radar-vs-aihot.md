# Radar 与 AIHOT 的产品差异

> 决策票：[界定 Radar 与 AIHOT 的产品差异](https://github.com/s0ftnote/radar/issues/2)
>
> 核查日期：2026-08-20
>
> 范围：只依据 Radar 当前 [`CONTEXT.md`](https://github.com/s0ftnote/radar/blob/522ad9f8e6048561c3613fe8d69fb8a538aa1ce6/CONTEXT.md)，以及 AIHOT 当前官网、公开 Skill、MCP/API/RSS 说明、使用规则和更新日志。没有把 AIHOT 未公开的内部实现当成事实。

## 决策结论

Radar 与 AIHOT **可以成为不同产品，但当前差异只在满足三个条件时成立**：

1. 用户先定义一个长期任务，Radar Brief 真正控制后续的收集、判断与报告，而不只是给同一份公共内容加一层提示词；
2. Radar 保存用户任务的跨期状态——Brief 版本、采用/忽略及原因、来源覆盖、前次结论和反馈——并让这些状态改变下一轮结果；
3. 首个 Demand Radar 交付的是“有来源证据、可继续验证的需求判断”，而不是 AI 行业动态、热点或个性化新闻摘要。

若做不到这三点，Radar 只是 **AIHOT 或 RSS 上面的个性化简报包装层**。自然语言配置、更多连接器、飞书推送、AI 摘要、日报、MCP 和本地数据库都不是独立产品楔子。

建议把可验证楔子收窄为：

> 用户确认一份“我想持续发现哪类未满足需求”的 Radar Brief；系统保留可回链的用户原话和来源覆盖，跨期判断需求是否重复、增强或减弱；用户的纠错必须改变下一份报告。

AIHOT 在此关系中可以是高质量的 AI 行业上游之一，不是 Radar 的对手性底座，也不能是 Radar 全部证据的代用品。

## 1. 两个产品当前各自在完成什么任务

### AIHOT：公共 AI 行业编辑与分发

AIHOT 自称“AI 行业动态聚合”，首页给所有读者同一套 AI 精选、评分、摘要、推荐理由和热点；“全部 AI 动态”再提供搜索及固定内容分类。[首页](https://aihot.virxact.com/)、[全部动态](https://aihot.virxact.com/all)、[关于](https://aihot.virxact.com/about)

它已经不是简单 RSS 列表：

- 精选算法减少公关稿、客户案例、营销软文和低价值论文；同一事件优先官方公告或当事人原始发声，转发与重复报道折叠。[更新日志](https://aihot.virxact.com/changelog)
- 热点榜把过去 48 小时的多信源报道合并为持续事件，提供排名、时间线、动态综述和 24 小时/3 天/7 天走势。[热点榜](https://aihot.virxact.com/hot)、[更新日志](https://aihot.virxact.com/changelog)
- 它提供日、周、月公共编辑报告和持续更新的主题页。[日报](https://aihot.virxact.com/daily)、[周报](https://aihot.virxact.com/weekly)、[月报](https://aihot.virxact.com/monthly)、[主题](https://aihot.virxact.com/topics)
- 人和 Agent 可以经网页、Skill、远程 MCP、RSS 和 REST API 读取同一公共内容层。[Agent 接入](https://aihot.virxact.com/agent)、[公开 Skill](https://aihot.virxact.com/aihot-skill/SKILL.md)

因此，AIHOT 的核心用户任务是：**低成本知道 AI 行业今天发生了什么、现在什么最热，并读取一份站方已经完成判断的公共编辑成品。**

### Radar：用户委托的长期关注任务

Radar 当前领域定义不是新闻聚合，而是：“用户描述自己想持续知道什么，Radar 按此形成长期运行的关注任务并交付报告”。Radar Brief 由 AI 从自然语言目标中整理关注目标、重点对象、判断标准、排除项与交付偏好，并须由用户确认或修改；Report 应共享来源证据，并按该场景解释其意义。[Radar `CONTEXT.md`](https://github.com/s0ftnote/radar/blob/522ad9f8e6048561c3613fe8d69fb8a538aa1ce6/CONTEXT.md)

首个场景 Demand Radar 又进一步限制了任务：关注“高呼声、正在变化且可能尚未被充分满足的需求与痛点”，不是通用趋势榜或竞品监控。[Radar `CONTEXT.md`](https://github.com/s0ftnote/radar/blob/522ad9f8e6048561c3613fe8d69fb8a538aa1ce6/CONTEXT.md)

所以 Radar 应回答的是：**对我正在追踪的需求问题，今天新增了什么证据，它为什么改变或没有改变已有判断，我下一步应验证什么。**

这才是一级产品差异。若报告仍以“今日重点 10 条”为中心，Radar 实际完成的仍是 AIHOT 的任务。

## 2. 七个维度的逐项判断

| 维度 | AIHOT 当前公开能力 | Radar 要成立的不同点 | 判断 |
|---|---|---|---|
| **用户任务** | 面向中文 AI 读者与 Agent 的公共行业精选、热点、搜索和报告；Skill 的默认意图也是“今天/最近 AI 新闻、热点、日报、指定公司或主题”。[Skill 工作流](https://aihot.virxact.com/aihot-skill/SKILL.md) | 用户委托一个长期存在的关注任务；Demand Radar 的对象是未满足需求及其证据，而不是 AI 新闻。 | **真实差异**，但必须以“需求判断”而非“内容摘要”验收。 |
| **个性化位置** | 用户可搜索关键词、选固定分类、收藏和标记已读；Agent 可按问题查询。收藏与已读只保存在当前浏览器，换设备不继承。[全部动态](https://aihot.virxact.com/all)、[更新日志](https://aihot.virxact.com/changelog) | 个性化发生在收集前和判断中：经确认的 Brief 控制对象、判断标准、排除项、来源需求和交付方式；反馈继续修改后续判断。 | **潜在真实差异**。若只是报告生成时加 prompt，则只是包装。 |
| **来源控制** | 站方维护数百个 AI 信源和公开池；用户能在既有池内搜索/分类，不能从接入页为自己的任务添加任意来源或定义站方采集范围。公开池还明确排除未审、低相关、已合并重复条目及部分公众号池。[Agent 接入](https://aihot.virxact.com/agent)、[Skill 能力边界](https://aihot.virxact.com/aihot-skill/README.md)、[更新日志](https://aihot.virxact.com/changelog) | Source Network 对用户可见且可管理；不只显示来源名称，还应让用户知道某任务当前能覆盖什么、缺什么、哪里异常。[Radar `CONTEXT.md`](https://github.com/s0ftnote/radar/blob/522ad9f8e6048561c3613fe8d69fb8a538aa1ce6/CONTEXT.md) | **真实差异的必要条件**。来源复选框或“数量更多”本身不是楔子。 |
| **长期记忆** | AIHOT 有内容历史、日报归档、事件时间线，并支持 `selected/snapshot + changes` 维护当前全部精选的私有副本；这说明“能长期同步内容”不是 Radar 独有。[API 参考](https://aihot.virxact.com/aihot-skill/references/api.md)、[同步合同](https://aihot.virxact.com/aihot-skill/references/sync.md) | 保存的是用户任务状态：Brief 及版本、Signal 与原始证据、采用/忽略及原因、前后报告判断、反馈和来源健康；下一轮必须消费这些状态。 | **最可能形成产品资产的真实差异**。只存文章和报告归档不算。 |
| **报告** | 公共日/周/月报已成熟；日报 API 保留 lead、sections、flashes，正式周/月报当前只有网页。[日报](https://aihot.virxact.com/daily)、[API 参考](https://aihot.virxact.com/aihot-skill/references/api.md) | 每个 Report 针对一份 Brief，解释共同证据对该场景的意义，并与上期判断连接；应暴露证据不足和来源缺口。 | **有条件的真实差异**。换标题、排序、语气或飞书模板只是包装。 |
| **产品资产** | AIHOT 的现有资产是 AI 信源网络、筛选标准、一手优先、事件归并、公共内容库、编辑报告、模型榜、品牌与稳定分发协议。[首页](https://aihot.virxact.com/)、[热点榜](https://aihot.virxact.com/hot)、[Agent 接入](https://aihot.virxact.com/agent)、[更新日志](https://aihot.virxact.com/changelog) | Radar 的候选资产是“Brief → Signal → 判断 → Report → 反馈”的私有历史，以及每个任务的来源能力状态和跨期需求证据。 | **尚未拥有，只是待验证资产假设**。不能在产品验证前宣称壁垒。 |
| **可验证楔子** | AIHOT 可以回答指定关键词最近 7 天有什么，但普通历史搜索超过 7 天不保证；它也可让调用方同步当前精选。[Skill 边界](https://aihot.virxact.com/aihot-skill/README.md)、[API 参考](https://aihot.virxact.com/aihot-skill/references/api.md) | 针对一个真实需求问题，跨期保留原始用户表达、重复/变化判断和用户纠错；下一份报告可证明因反馈而更合用。 | **可测且足够窄**；不需要先证明“全网覆盖”或实现通用情报平台。 |

## 3. 不应误判为差异的 AIHOT 能力

### “AIHOT 没有 API，所以 Radar 更自动化”——错误

AIHOT 已提供四条匿名只读接入轨道：Skill、远程 MCP、RSS、REST API；MCP 能查最新、搜索、热点、事件和日报。[Agent 接入](https://aihot.virxact.com/agent)

v1 API 支持 ETag、分页、明确错误合同，以及精选 `snapshot + changes` 增量同步。[API 参考](https://aihot.virxact.com/aihot-skill/references/api.md)、[同步合同](https://aihot.virxact.com/aihot-skill/references/sync.md)

所以“MCP 接入”“Agent 可读”“自动同步”“增量更新”都不能作为 Radar 的产品差异。

### “AIHOT 只是链接聚合，Radar 会做判断”——错误

AIHOT 已做 LLM 摘要、评分、精选理由、噪声过滤、一手来源优先、重复报道折叠和事件级综述。[首页](https://aihot.virxact.com/)、[热点榜](https://aihot.virxact.com/hot)、[更新日志](https://aihot.virxact.com/changelog)

Radar 的判断必须不同在**判断对象和用户标准**：把多条用户表达判断为某个需求是否重复、变化、未满足，并按用户确认过的标准解释；不是再给新闻打一遍分。

### “AIHOT 没有长期数据，Radar 会存历史”——不准确

AIHOT 有日报归档、热点事件时间线和趋势曲线，也允许调用方持久同步当前精选。真正缺少公开证据的是**用户级长期任务记忆**，而不是内容历史。[日报](https://aihot.virxact.com/daily)、[热点榜](https://aihot.virxact.com/hot)、[同步合同](https://aihot.virxact.com/aihot-skill/references/sync.md)

AIHOT Skill 安装生成的随机 Actor ID 也明确“不是账号、API Key 或授权”，只用于同一直接消费实例跨渠道去重；不能把它误读为个人画像或任务记忆。[Skill README](https://aihot.virxact.com/aihot-skill/README.md)

### “个性化日报就是新产品”——不成立

对公共精选做关键词过滤、重新排序、摘要和飞书推送，技术上可以直接组合 AIHOT API、RSS 与任意 Agent 完成。AIHOT 甚至已经给出日报 API 和长期稳定 RSS。[Agent 接入](https://aihot.virxact.com/agent)、[API 参考](https://aihot.virxact.com/aihot-skill/references/api.md)

只有当日报呈现“自上次以来哪些证据改变了任务判断、为什么、需要用户决定什么”，并把反馈带入后续周期，才形成 Radar 的产品闭环。

### “更多来源就是差异”——不成立

AIHOT 当前聚焦 AI 行业，Radar 的 Demand Radar 必然需要 AIHOT 未声明覆盖的需求证据来源。但连接器数量只是覆盖能力，既容易复制，也受平台许可和稳定性制约。Source Network 的产品价值应是**对具体任务可解释的覆盖、缺口、异常和替代路径**，不是“全网”口号。[Radar `CONTEXT.md`](https://github.com/s0ftnote/radar/blob/522ad9f8e6048561c3613fe8d69fb8a538aa1ce6/CONTEXT.md)

## 4. 真正可能积累的产品资产

以下资产与 AIHOT 的公共编辑资产互补，而不是复制：

1. **经确认的任务模型**：用户真正关心的目标、对象、判断标准、排除项和交付偏好，以及这些字段为什么改变。
2. **带理由的判断反馈**：用户不只是收藏，而是确认“相关/噪声/已知/证据不足/应继续追踪”，并让后续排序与来源选择变化。
3. **跨期需求证据链**：同一需求的原始表达、来源、时间、上下文、重复与反证；报告结论可回溯到证据。
4. **任务级来源能力历史**：哪些来源对某类 Brief 有效、失效或缺席；报告能区分“没有信号”和“来源没覆盖”。
5. **判断演化**：一个需求为何从孤例升级、为何减弱、何时被推翻，用户后来是否采取验证行动。

其中 1、2、5 来自持续使用后的私有交互，最不容易被“多抓几个源”复制。3、4 有价值，但会受到来源许可、留存政策和平台断链影响。

需要诚实标注：这些目前都是 Radar 的**候选资产**，不是仓库已经拥有的数据或被用户验证的壁垒。

## 5. 建议的最小可验证楔子

### 假设

对需要持续找小需求的独立开发者/产品人，一份能记住任务标准、保留用户原话、跨期判断需求变化并吸收纠错的报告，比“AIHOT/公开信息流 + 一次性个性化摘要”更有用。

### 最小验证对象

只验证一个 Demand Radar，不同时扩展竞品、技术、价格和通用趋势场景：

1. 用户用自然语言描述一个确实想持续发现的需求范围；
2. AI 整理成 Radar Brief，用户确认目标、判断标准、排除项和报告节奏；
3. 连续至少两个周期交付 Report，每条关键判断都可回到原始 Signal/来源；
4. 用户对第一期做最小反馈（采用、忽略、纠错或调整 Brief）；
5. 第二期明确显示反馈怎样改变了证据选择、判断或来源策略。

### 必须设置的基线

同一问题同时生成一个廉价基线：“AIHOT 最近 7 天关键词查询/相关 RSS + 通用摘要 prompt”。如果用户无法稳定指出 Radar 在需求证据、跨期变化或后续行动上更有用，说明差异仍是包装。

### 通过信号

- 用户能从 Report 中指出一个以前不知道、且愿意继续验证的需求判断；
- 该判断能展开到多个可核查 Signal，而非模型自由发挥；
- 用户能说清它相较公共资讯摘要多回答了什么；
- 用户的纠错在下一期产生可见变化，而不是只改当期文案；
- 用户愿意保留该 Radar 继续运行，或据此采取访谈、搜索、原型等下一步。

### 失败信号

- 报告主体仍是文章/帖子清单；
- 换成 AIHOT、RSS 加通用 prompt，用户体验没有明显下降；
- 每期重新从零总结，无法解释与上期判断的关系；
- “个性化”只体现在关键词、排序、语气或渠道；
- 用户反馈没有进入下一周期；
- 需求结论无法回到原始表达，或把单条抱怨包装成机会。

## 6. AIHOT 应处在 Radar 的什么位置

AIHOT 可作为技术使能、AI 产品变化和行业背景的高质量上游。其一手优先、事件去重和公共编辑能减少 Radar 重复建设；Agent/API/RSS 又便于个人与组织内部接入。[更新日志](https://aihot.virxact.com/changelog)、[Agent 接入](https://aihot.virxact.com/agent)

但有四条边界：

1. AIHOT 的普通 items 查询只承诺 24 小时或 7 天；正式周/月报只有网页。Radar 若需要长期回溯，必须拥有自己的任务状态，不能把滚动查询当记忆。[Skill README](https://aihot.virxact.com/aihot-skill/README.md)、[API 参考](https://aihot.virxact.com/aihot-skill/references/api.md)
2. AIHOT 公开池不是原始全库，未审、低相关、重复项及部分来源不会返回；不能用它证明某个需求“没有证据”。[Skill README](https://aihot.virxact.com/aihot-skill/README.md)
3. API 没有按 item ID 取单篇正文的端点，全文输出还受来源授权门禁；重要判断仍应回第三方原文核对。[Skill README](https://aihot.virxact.com/aihot-skill/README.md)、[API 参考](https://aihot.virxact.com/aihot-skill/references/api.md)
4. 个人非商业、公益非商业和组织内部使用可匿名免费；面向外部的商业产品、收费服务、客户交付、镜像、转售或批量再分发需要 AIHOT 书面授权。MIT 只覆盖 Skill 文件，不覆盖服务和数据。[公开使用规则](https://aihot.virxact.com/terms)、[Skill README](https://aihot.virxact.com/aihot-skill/README.md)

因此，MVP 可以把 AIHOT 当作一个可替换的 Source Network 节点；不能让 Radar 的差异、数据完整性或未来商业权利依赖它。

## 7. 本票应记录的决定

建议关闭本票并采用以下边界：

- Radar 不竞争“更全、更快、更好读的 AI 行业公共资讯”；AIHOT 在这个任务上已经有完整产品。
- Radar 的产品单元是长期 Radar Project，不是文章、Feed、关键词或日报。
- 个性化必须位于收集与判断之前，并经反馈持续改变后续周期；报告末端换 prompt 不算。
- 长期记忆指用户任务和判断的历史，不泛指保存文章或报告归档。
- Source Network 要表达任务级覆盖、异常与缺口；来源多寡不是产品楔子。
- Demand Radar 的首个验证只证明“证据化需求判断 + 跨期反馈闭环”是否优于公共信息流摘要。
- AIHOT 可作为上游，但使用范围必须遵守其许可，且不得成为需求结论的唯一证据池。

最终界线可以压缩成一句话：

> **AIHOT 编辑一份公共 AI 行业事实流；Radar 接受一项个人长期任务，记住用户如何判断证据，并让这些判断改变下一份报告。**

## 一手资料索引

### Radar

- [Radar `CONTEXT.md`（固定提交）](https://github.com/s0ftnote/radar/blob/522ad9f8e6048561c3613fe8d69fb8a538aa1ce6/CONTEXT.md)

### AIHOT 产品与内容

- [首页](https://aihot.virxact.com/)
- [全部 AI 动态](https://aihot.virxact.com/all)
- [热点榜](https://aihot.virxact.com/hot)
- [日报](https://aihot.virxact.com/daily)、[周报](https://aihot.virxact.com/weekly)、[月报](https://aihot.virxact.com/monthly)
- [主题](https://aihot.virxact.com/topics)
- [关于](https://aihot.virxact.com/about)
- [更新日志](https://aihot.virxact.com/changelog)

### AIHOT 机器接入与规则

- [Agent 接入](https://aihot.virxact.com/agent)
- [Agent Skill README](https://aihot.virxact.com/aihot-skill/README.md)
- [Agent Skill](https://aihot.virxact.com/aihot-skill/SKILL.md)
- [REST API 参考](https://aihot.virxact.com/aihot-skill/references/api.md)
- [精选同步合同](https://aihot.virxact.com/aihot-skill/references/sync.md)
- [OpenAPI v1](https://aihot.virxact.com/openapi-v1.json)
- [公开使用规则](https://aihot.virxact.com/terms)
