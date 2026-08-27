# Web 是实时工作台，Agent 是执行者

Radar 安装并启动后，Agent 直接给用户当前本地 WebUI URL。WebUI 是长期工作台：首页列任务，任务详情展示并允许编辑 Brief，同时列出来源内容与 Agent 保存回 Radar 的报告；文档详情展示摘要、标签、作者、平台与原文入口；来源页继续展示覆盖与运行状态。

WebUI 不做新手引导流程。会话已经承担安装与首次使用引导，页面只永久摆出三个可复制入口：`/radar-steward`、`/radar-delivery`、`/open-radar`。`radar-judgment` 是管家与取数流程内部的接力，不要求普通用户直接触发。

WebUI 中的一条“任务”就是一个 Radar Brief，不增加 Task 领域对象。取数角色生成的报告正文正式保存进 Radar，连同标题、生成者、时间与取材判断供 WebUI 读取；交付记录仍只负责回答某条判断是否送到某个外部去处，二者不合并。

Agent 与 WebUI 写的是同一份 Radar 状态。所有成功写操作向已打开的页面发送失效事件，页面重新读取服务端真相；后台采集完成也发同样事件。页面不维护第二份客户端状态。现阶段用服务端 HTML 加一条单向事件流完成，不引入前端应用框架。

## Consequences

- [ADR 0017](0017-web-has-two-pages-content-first-then-sources.md) 的“内容流是首页”被本决策替代；首页改为任务列表，内容收进任务详情。
- [ADR 0013](0013-the-web-is-one-source-page-everything-else-is-conversation.md) 中“Brief 与报告不上 Web”被替代；来源页本身的端点状态与目录分组结论继续有效。
- Agent 继续只通过 CLI 操作 Radar，[ADR 0012](0012-the-operation-surface-is-a-cli-not-mcp.md) 不变；WebUI 是面向人的另一操作面。
- 报告不再只存在于对话或外部知识库，`radar report create` 是取数角色完成一次报告的必要写回。
- WebUI 的任务移除采用归档语义：任务退出活动工作台，但 Brief 修订、判断、报告、反馈与交付历史继续保留。
- 页面没有首次使用状态、引导遮罩或步骤清单；空任务与空报告只陈述现状和可执行入口。
