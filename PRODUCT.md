# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Radar 面向把自己的 AI Agent 作为日常工作入口、并希望在本机持续追踪外部信号的单个用户。用户安装并启动 Radar 后，在 Agent 对话里完成配置和执行，在 WebUI 中长期查看、编辑与回顾任务、内容、报告和来源状态。

## Product Purpose

Radar 是开源、本地运行的个性化信号聚合站。用户用自然语言描述想持续知道什么，Radar 按 Brief 采集外部来源、维护待判断队列，并保存判断、报告、反馈与交付历史。成功意味着用户可以从一个 Brief 出发，持续获得有依据、可核查、不会重复交付的判断与报告。

## Positioning

Radar 自身不调用模型。全部 AI 判断、报告生成和自然语言配置由用户自己的 Agent 通过随 Radar 分发的 Skill 完成；Radar 只负责确定性的采集、排队、持久化和本地 Web 工作台。用户拥有实例、来源凭据、数据与历史，不依赖 Radar 账号或云端。

## Operating Context

安装后，Agent 返回本地 WebUI URL。用户可以在 WebUI 查看任务列表，进入任务编辑 Brief、检查来源、阅读文档判断和持久化报告，也可以独立管理来源。WebUI 永久提供 `/radar-steward`、`/radar-delivery`、`/open-radar` 三个可复制入口，让用户随时回到自己的 Agent 执行工作。Agent、CLI、后台采集和 WebUI 共享同一份服务端状态，并通过实时失效事件刷新页面。

## Capabilities and Constraints

- WebUI 中的“任务”就是 Radar Brief，不存在第二个 Task 领域对象。
- Brief、来源内容、判断、反馈、报告与交付记录均持久化；报告与交付记录是不同对象。
- 从工作台移除任务只归档 Brief；判断、报告与交付历史不物理删除。
- 文档详情展示摘要、标签、作者、平台、时间、判断依据和原文入口。
- Radar 服务是 SQLite 的唯一写者；Agent 只通过 Radar CLI 操作。
- WebUI 使用服务端 HTML 与单向事件流，不引入前端应用框架。
- WebUI 不包含首次使用向导；安装与首次配置由 Agent 会话负责。
- 默认单用户、本地优先，数据目录由用户控制。

## Brand Commitments

产品名为 Radar。产品语言直接、克制、事实导向，不把 Radar 描述成内置 AI、新闻聚合器、云端账号或知识库。界面中的中文和英文均使用无衬线字体。

## Evidence on Hand

真实产品领域与用户旅程记录在 `CONTEXT.md`、`docs/adr/0019-web-is-the-live-workbench-and-agent-is-the-executor.md` 和现有服务端页面实现中。仓库没有客户评价、商业指标或品牌影像；未来视觉工作不得虚构这些内容。

## Product Principles

- Agent 负责理解与执行，Radar 负责确定性状态与可核查历史。
- WebUI 是长期工作台，不是安装向导或营销页面。
- 用户意图以 Brief 为中心，来源、判断与报告都从属于它。
- 页面永远展示真实服务端状态，不维护第二份客户端真相。
- 用户拥有本地数据、凭据和外部知识沉淀。

## Accessibility & Inclusion

核心状态与操作不能只依赖颜色或动效表达；键盘焦点、文本对比度、移动端触控目标与 reduced-motion 偏好必须可用。
