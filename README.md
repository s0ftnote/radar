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
