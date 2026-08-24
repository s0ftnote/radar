# Radar

Radar 是一个开源、本地优先的个人情报工作台。当前 walking skeleton 可以持久化 Radar Project、首个 Radar Brief 修订、公开 RSS/Atom 来源版本、由 Agent 判断形成的情报条目，以及从固定情报修订生成的 Report；所有数据保存在你控制的设备上。

## 本地启动

前置条件：Node.js 24.14 或更高版本、npm。

```bash
npm install
npm run radar
```

`npm run radar` 是唯一主要启动命令。它会：

- 自动创建本地数据目录（默认是仓库中的 `.radar/`）；
- 将 Web 界面绑定到 `127.0.0.1`，默认地址为 `http://127.0.0.1:3000`；
- 在启动 Web 进程前验证 SQLite 数据位置可写，并在终端打印数据路径与 Next.js 启动诊断；
- 不要求 Radar 账号、产品登录或任何托管服务。

通过 `RADAR_DATA_DIR` 可以把数据放到另一个用户控制的位置：

```bash
RADAR_DATA_DIR=/path/to/my-radar-data npm run radar
```

停止进程后再次运行同一命令，Radar Projects、来源版本、Agent 运行、情报条目和 Report 生成历史会从该目录恢复。

## 本地 Agent 适配器

Radar 通过一个厂商无关的 HTTP JSON 边界运行来源判断和 Report 生成。把用户控制的本地适配器 endpoint 和可选 token 放在进程环境中：

```bash
RADAR_AGENT_ENDPOINT=http://127.0.0.1:8787/agent \
RADAR_AGENT_TOKEN=your-local-secret \
npm run radar
```

Radar 会向同一 endpoint 发送 `POST`，并用 `x-radar-operation` 标明操作。`judge` 的请求体包含当前 `radarBriefRevision` 与一个明确的 `sourceVersion`；适配器返回以下两种结果之一：

```json
{ "match": false, "reason": "与当前 Brief 不相关的理由" }
```

```json
{
  "match": true,
  "judgmentKey": "adapter-owned-stable-judgment-key",
  "title": "情报条目标题",
  "judgment": "证据化判断",
  "rationale": "为什么与当前 Brief 相关",
  "evidence": { "quote": "来源版本中的原文摘录" }
}
```

`judgmentKey` 在当前 Project 内标识判断，而不是 feed entry。`evidence.quote` 必须能在提交给 Agent 的来源版本标题或正文中定位；Radar 会自行记录字段与字符区间。`RADAR_AGENT_TOKEN` 只用于请求授权，不会写入领域记录或页面。

`generate_report` 的请求体固定内容目的、目标受众、核心角度、来源截止点，以及选中的情报条目修订和 Signal。适配器返回由主张组成的结果；每项主张只能引用本次输入中的修订与 Signal：

```json
{
  "title": "Report 标题",
  "claims": [
    {
      "text": "一项可追溯主张",
      "epistemicRole": "inference",
      "intelligenceItemRevisionId": "selected-revision-id",
      "signalIds": ["selected-signal-id"]
    }
  ]
}
```

`epistemicRole` 必须是 `evidence`、`inference` 或 `user_viewpoint`，分别表示证据陈述、基于证据的推断或用户明确提供的观点。每个选中的情报条目修订都必须至少形成一项主张。

Radar 会先保存 Report 输入快照，再调用适配器；失败可按原快照重试，成功生成的历史 Report 不会因后续来源或 Signal 变化而改写。

## 验证

```bash
npm run typecheck
npm run test:e2e
npm run build
```

浏览器验收从空白临时数据目录启动真实 Radar 进程，只通过公开 Web 界面驱动 Project、来源采集、Agent 判断和 Report 生成，并验证进程重启后的持久化。
