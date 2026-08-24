# Radar

Radar 是一个开源、本地优先的个人情报工作台。当前 walking skeleton 可以持久化 Radar Project、首个 Radar Brief 修订、公开 RSS/Atom 来源版本，以及由 Agent 判断形成的 Signal 和首个情报条目修订；所有数据保存在你控制的设备上。

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

停止进程后再次运行同一命令，Radar Projects、来源版本、Agent 运行和情报条目会从该目录恢复。

## 本地 Agent 适配器

Radar 通过一个厂商无关的 HTTP JSON 边界运行判断。把用户控制的本地适配器 endpoint 和可选 token 放在进程环境中：

```bash
RADAR_AGENT_ENDPOINT=http://127.0.0.1:8787/judge \
RADAR_AGENT_TOKEN=your-local-secret \
npm run radar
```

Radar 会向 endpoint `POST` 当前 `radarBriefRevision` 与一个明确的 `sourceVersion`。适配器返回以下两种结果之一：

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
  "evidence": { "quote": "来源版本中的原文摘录", "locator": "可读的证据位置" }
}
```

`judgmentKey` 在当前 Project 内标识判断，而不是 feed entry。`evidence.quote` 必须能在提交给 Agent 的来源版本标题或正文中定位。`RADAR_AGENT_TOKEN` 只用于请求授权，不会写入领域记录或页面。

## 验证

```bash
npm run typecheck
npm run test:e2e
npm run build
```

浏览器验收从空白临时数据目录启动真实 Radar 进程，只通过公开 Web 界面驱动 Project、来源采集和 Agent 判断，并验证进程重启后的持久化。
