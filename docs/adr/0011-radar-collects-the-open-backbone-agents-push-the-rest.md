# Radar 自采无登录态骨干，需登录态的渠道由 Agent 推送

采集渠道分两档执行。**装好即用**的渠道——原生 RSS/Atom、GitHub 官方 API、V2EX、YouTube 这类无需凭据的来源——由 Radar 核心自己按计划采集，用户装好实例即开始产生来源内容，一个字都不用配。**配置后解锁**的渠道——Reddit、B 站字幕、Twitter/X、小红书、Facebook、Instagram、LinkedIn 这类依赖登录态的平台——Radar 不写适配器、不保管登录态，改由用户自己的 Agent 用它已有的采集工具（agent-reach 等）采集后推送给 Radar。这些渠道下的采集端点仍须先在 Radar 登记，推送时带端点标识，Agent 推来的内容才有来源归属，去重、来源状态与开关才成立。

Radar 不可替代的地方是持续、有状态、Agent 不在也在跑，而这个价值在无登录态骨干上就已经完全成立。需登录态平台带来的是覆盖面，覆盖面恰恰是 agent-reach 这类工具已经解决且在持续维护的；[#39](https://github.com/s0ftnote/radar/issues/39) 也已经查明 Agent-Reach 没有统一读取 API，不能被包成渠道。让 Radar 把十五个平台的适配器重做一遍，换来的是一个必须长期维护 Cookie 过期与浏览器桥的烂摊子——[#3](https://github.com/s0ftnote/radar/issues/3) 已经踩过这个坑。分工之后 Radar 的实现面积小一个数量级，而用户看到的心智不变：好搞的自动来，不好搞的自己折腾一下就解锁。

## Consequences

- 配置后解锁的渠道在用户 Agent 不运行时不产生新的来源内容；这是这个分工的直接代价，不是故障。
- Radar 只为装好即用的渠道保管凭据边界（实际上它们不需要凭据）；登录态留在用户 Agent 与它的采集工具那一侧，Radar 不碰。
- 采集执行者（Radar 自采 / Agent 推送）不是渠道的第三个属性，它就是配置状态那一档的另一种说法——目录里两种端点长得一模一样。
- Radar Skill 因此必须有登记采集端点与推送来源内容的操作；这些操作的形状归 [#43](https://github.com/s0ftnote/radar/issues/43)。
- "够不着"收窄为没有任何后端能到达，在 agent-reach 的覆盖下会很少，但保留它作为覆盖缺口的表达。
