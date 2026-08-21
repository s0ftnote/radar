# Radar

Radar 是一个让用户把持续寻找、筛选和整理信息的工作交出去的个人情报产品。用户描述自己想持续知道什么，Radar 按此形成长期运行的关注任务并交付报告。

## Language

**Radar**:
由自然语言目标驱动、持续收集和判断外部信号，并定期交付个性化报告的个人情报产品。
_Avoid_: 新闻聚合器、搜索器、爬虫

**Radar 任务**:
用户在 Radar 中创建的一个长期关注项目。每个 Radar 任务有自己的 Radar Brief、Report 与反馈。
_Avoid_: Radar、订阅源

**Agent**:
用户用来操作 Radar、参与收集、筛选或生成 Report 的 AI Agent。Hermes、OpenClaw、Pi、Claude Code 与 Codex 都可以承担这个角色。
_Avoid_: Hermes

**Radar Brief**:
AI 根据用户的自然语言描述整理出的关注目标、重点对象、判断标准、排除项与交付偏好，须由用户确认或修改。
_Avoid_: 筛选条件、关键词配置

**Report**:
Radar 针对一种场景交付的结果，其中包含共同的来源证据，并按场景解释这些证据的意义。
_Avoid_: Feed、资讯列表

**Demand Radar**:
Radar 的首个验证场景，关注高呼声、正在变化且可能尚未被充分满足的需求与痛点。
_Avoid_: 通用趋势榜、竞品监控

**来源内容**:
Radar 从 Source Network 接收到、但尚未根据某个 Radar Brief 判断是否相关的内容。来源内容只有通过相关性判断后，才会成为该 Radar 任务的 Signal。
_Avoid_: Signal

**Signal**:
Radar 从来源中识别出的、可能与 Radar Brief 有关且值得进一步判断的事实或表达。
_Avoid_: 文章、帖子、新闻

**Source Network**:
Radar 当前能够收集的来源及其能力状态的集合；其覆盖范围、异常和扩展情况对用户可见且可管理。
_Avoid_: 全网、数据源清单

**Report 条目**:
Report 中用户可以逐条判断的最小单位，也是用户表达要或不要的对象。在 Demand Radar 中，一个 Report 条目是一个需求判断，Signal 作为它的证据附在其下。Report 条目有身份，可以跨期延续。
_Avoid_: 文章、卡片、一条资讯
