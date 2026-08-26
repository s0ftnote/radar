# Radar

开源、本地运行的个性化信号聚合站。你用自然语言说想持续知道什么，Radar 据此持续采集来源内容、
排成待判断队列，并保存判断、反馈与交付历史。**全部 AI 工作由你自己的 Agent 承担**——Radar
不调用任何模型，也不拥有知识沉淀。

## 装上并跑起来

```sh
npm i -g radar
radar up
```

`radar up` 在本机起一个只听 `127.0.0.1` 的常驻服务：按计划采集的调度器、SQLite 的唯一写者、
`radar` 命令的服务端，也是两张网页的 HTTP 服务：`/` 是内容页——Radar 攒下了什么、AI 判过什么、
哪些还没轮到，可以按档和来源筛，也可以在一条上说「有用 / 没用」；`/sources` 是来源页——它现在
够得着什么、什么坏了、什么在等推送。Ctrl-C 干净退出，再起一次数据还在。

数据默认落在 `~/.radar`，`RADAR_DATA_DIR` 可以改。一个数据目录只允许一个服务——起第二个会
明确失败，不会静默争抢同一个 SQLite。

命令面以 `radar --help` 为准。

## 把三份 Skill 装进你的 Agent

```sh
radar skills install          # 默认装到 ~/.claude/skills，幂等覆盖
npx skills add s0ftnote/radar # 或者不经 Radar
```

装进去的是三份 model-invoked 的 Skill，你的 Agent 自己认出该用哪一份：

- **管家**（`radar-steward`）——建改 Brief、登记与开关来源、下发排队策略、写回反馈。
  你读报告时随口一句「这条没意思」，它认得出那是反馈。
- **判断**（`radar-judgment`）——取工作包、逐条判断、写回判断；需要登录态的渠道也由它采下来
  推给 Radar。
- **取数**（`radar-delivery`）——出周报、往 Obsidian 里写，取判断作素材，送完按去处记一笔账。

装完你就只跟 Agent 说话。**主路径**：告诉它你想持续知道什么 → 它建 Brief、催一次采集、接上
判断角色跑第一遍给你看 → 你随口评价 → 它写回反馈 → 下一周期的判断读得到那条反馈。

Skill 里写的是**命令的时机与判断，不是命令的用法**——用法现场 `radar --help`。所以 Skill 与
CLI 之间没有契约版本号，也不做版本检测：`radar skills install` 装的就是随这一版 Radar 一起
下来的那三份。

`radar up` 没在跑时，Skill 会照实告诉你「Radar 服务没在跑」并让你先 `radar up`——它不会凭
记忆编一份周报，也不会绕过 CLI 自己去读数据目录。

## 粘一个网址加源

```sh
radar discover https://example.com/blog
```

依次尝试：RSSHub 规则库 → 页面自带的 feed → 认得该域名的渠道适配器。可能给出**多条候选**
（同一个主页往往对应视频、动态、专栏几条路由），挑一条 `radar sources add` 进来，之后它就是
一条普通的 RSS/Atom 端点。**都不中就明说够不着**——抓 HTML 拼出来的东西页面改个版就会悄悄
空掉，而你以为自己还被覆盖着。

RSSHub 不是采集渠道，只是一份随版本打包的规则快照，加上一处实例级设置：

```sh
radar rsshub set http://localhost:1200
```

不填就跳过 RSSHub 那一步匹配，Radar 不替你找一台公共实例。填了就每天从你自己那台刷新规则；
规则只在粘网址那一刻用一次，加进来的端点跟它彻底脱钩。

这两件事在 `/sources` 那张来源页上也做得了。

## 队列只排序，不丢弃

采得多是常态，判得完不是。Radar 按你下发的打分公式排序，从不因为排在后面就丢掉；超过保留
窗口（默认 30 天）还没判断的移出待判断队列，但一行都不删，`radar requeue` 随时捞回来重判。

## 操作面是 CLI

Radar 交给 Agent 的唯一操作面是 `radar` 命令，不是 MCP，也不是 HTTP。CLI 是本地服务的瘦
客户端，自己不碰数据库；服务没起来时它照实报错。HTTP 面是内部实现，可以随时改形状，只要
`radar` 的命令面不变。

## 从源码跑

```sh
npm install
npm run build && node dist/cli/main.js up
npm test
```

架构决策记在 `docs/adr/`，都在仓库里。
