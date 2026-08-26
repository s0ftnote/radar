# Radar

开源、本地运行的个性化信号聚合站。你用自然语言说想持续知道什么，Radar 据此持续采集来源内容、
排成待判断队列，并保存判断、反馈与交付历史。**全部 AI 工作由你自己的 Agent 承担**——Radar
不调用任何模型，也不拥有知识沉淀（[ADR 0009](docs/adr/0009-radar-does-no-ai-and-owns-no-knowledge.md)）。

## 装上并跑起来

```sh
npm i -g radar
radar up
```

`radar up` 在本机起一个只听 `127.0.0.1` 的常驻服务：它是按计划采集的调度器、SQLite 的唯一写者、
`radar` 命令的服务端，也是那张来源页的 HTTP 服务（[ADR 0016](docs/adr/0016-the-runtime-is-one-node-process-not-a-next-app.md)）。
Ctrl-C 干净退出，再起一次数据还在。

数据默认落在 `~/.radar`，`RADAR_DATA_DIR` 可以改。一个数据目录只允许一个服务——起第二个会明确失败，
不会静默争抢同一个 SQLite。

命令面以 `radar --help` 为准。

## 把三份 Skill 装进你的 Agent

```sh
radar skills install          # 默认装到 ~/.claude/skills，幂等覆盖
```

或者不经 Radar：

```sh
npx skills add s0ftnote/radar
```

装进去的是三份 model-invoked 的 Skill，你的 Agent 自己认出该用哪一份，你不必点名：

- **管家角色**（`radar-steward`）——建改 Brief、登记与开关端点、下发排队策略、写回反馈。
  你读报告时随口一句「这条没意思」，它认得出那是反馈。
- **判断角色**（`radar-judgment`）——取工作包、逐条判断、写回判断；需要登录态的渠道也由它采下来推给 Radar。
- **取数角色**（`radar-delivery`）——出周报、往 Obsidian 里写，取判断作素材，送完按去处记一笔账。

装完之后你就只跟 Agent 说话。**主路径**是：跟它说你想持续知道什么 → 它建 Brief、催一次采集、
接上判断角色跑第一遍给你看 → 你随口评价 → 它写回反馈 → 下一周期的判断读得到那条反馈。

Skill 里写的是**命令的时机与判断，不是命令的用法**——用法现场 `radar --help`
（[ADR 0012](docs/adr/0012-the-operation-surface-is-a-cli-not-mcp.md)）。所以 Skill 和 CLI 之间
没有契约版本号，也不做版本检测：`radar skills install` 装的就是随这一版 Radar 一起下来的那三份。

**离线路径**：`radar up` 没在跑时，Skill 会如实告诉你「Radar 服务没在跑」并让你先 `radar up`——
它不会凭记忆编一份周报出来，也不会绕过 CLI 自己去读数据目录。

## 粘一个网址加源

```sh
radar discover https://example.com/blog
```

依次尝试：RSSHub 规则库 → 页面自带的 feed → 认得该域名的渠道适配器。可能给出**多条候选**
（同一个主页往往对应视频、动态、专栏几条路由），挑一条 `radar sources add` 进来，之后它就是
一条普通的 RSS/Atom 端点。**都不中就明说够不着，不降级去抓 HTML**——抓 HTML 拼出来的东西
页面改个版就会悄悄空掉，而你以为自己还被覆盖着。

RSSHub 不是采集渠道，只是一份随版本打包的规则快照，加上一处实例级设置：

```sh
radar rsshub set http://localhost:1200
```

不填就跳过 RSSHub 那一步匹配，Radar 不替你找一台公共实例。填了就每天从你自己那台刷新规则；
规则只在粘网址那一刻用一次，加进来的端点跟它彻底脱钩。

这两件事在那张来源页上也做得了。

## 操作面是 CLI

Radar 交给 Agent 的唯一操作面是 `radar` 命令，不是 MCP，也不是 HTTP
（[ADR 0012](docs/adr/0012-the-operation-surface-is-a-cli-not-mcp.md)）。CLI 是本地服务的瘦客户端，
自己不碰数据库；服务没起来时它如实报错，不会绕过去自己写。

HTTP 面是内部实现，可以随时改形状，只要 `radar` 的命令面不变。

## 从源码跑

```sh
npm install
npm run build && node dist/cli/main.js up
npm test
```
