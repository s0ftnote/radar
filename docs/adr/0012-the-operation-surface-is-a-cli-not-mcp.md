# Radar 交给 Agent 的操作面是 CLI，不是 MCP

用户 Agent 通过一个随 Radar 安装的 `radar` 命令读写 Radar：取工作包、写回判断、推送来源内容、取数与标记交付、建改 Brief、登记端点、下发排队策略、写回反馈。Radar 不提供 MCP server，Radar Skill 里也不出现 HTTP 端点——命令用法以 `radar --help` 为准。CLI 是本地 Radar 服务的瘦客户端，自己不碰 SQLite；Radar 服务本来就要常驻按计划采集，让它当唯一写者，省掉两个进程抢同一个数据库。

MCP 是 2026 年接 Agent 的默认答案，这里不选它，是两条理由压过了它的工具 schema 与参数校验。**一是常驻上下文**：MCP 把十来个工具的 schema 永久钉在每一轮对话里，而 Radar 的三个角色触发时机完全不同——判断是定时批处理，取数是用户要报告时，管家是用户随口改主意时。CLI 让三份 Skill 各自按需载入，一句「这条不要」不必拖进整套判断契约。**二是谁能接**：Radar 开源本地跑，立身之本是 Claude Code、Codex、OpenClaw、Hermes、Pi 都能用；能跑 bash 就能用 CLI，零配置，而 MCP 要求客户端支持 MCP 且每个 Agent 各配一次。附带的好处是大载荷不进上下文——`radar pending > /tmp/work.json` 之后用 `jq` 挑，MCP 的工具结果只能全量灌回去。

裸 HTTP + `curl` 同样零常驻，但 Skill 得把端口、路径与 JSON 形状全抄一遍，那是一份注定过期的缓存；多行判断文本在 curl 里手写转义也易碎。CLI 把这两样交给 `--help` 和 stdin。

## Consequences

- HTTP API 降为内部实现，不是契约。它可以随时改形状，只要 CLI 的命令面不变。
- `radar` 是 Radar 包的 `bin`，跟 Radar 同版本发布——CLI 与服务的版本对齐因此是免费的，Skill 与 CLI 的版本对齐不是。
- 想要 MCP 的用户自己包一层就行：CLI 的命令面已经是一份现成的工具清单。Radar 不维护它。
- Radar Skill 里写命令的**时机与判断**，不写命令的**用法**；用法抄进 Skill 就是等着它过期。
