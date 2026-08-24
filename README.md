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

每次成功生成 Report 后，Radar 会自动尝试派生一份独立的 HTML 平台物料包。物料包保存在 `RADAR_DATA_DIR/material-packages/`，可在 Project 页面预览或下载 ZIP；失败只影响本次包运行，不会回滚 Report。成功 Report 也可以单独补发新包，失败运行可以按原固定快照重试。

下载包以 `index.html` 为离线入口，并明确分离：

- `editorial.json`：标题、目的、受众、角度与有序主张；
- `render-source.json`：与具体渲染器解耦的语义块和资产关系；
- `assets/preview.png`：由同一 render source 派生的 PNG 预览；
- `assets/ZCOOLXiaoWei-Regular.ttf`、`assets/OFL.txt`：自托管标题字体及其开源许可证；
- `provenance.html`、`provenance.json`、`asset-provenance.json`：人类可读引用、机器映射与资产生成记录；
- `capability-snapshot.json`：HTML 下载路径及生成时核验状态；
- `manifest.json`：包身份、固定 Report 修订、文件类型、大小与 SHA-256。

HTML、样式、字体与 PNG 都使用包内相对路径。来源适配器只在能确认公开 canonical locator 时允许物料包导出该地址；当前 RSS/Atom 链路把未经独立确认的原始定位标为 withheld，仅保留不含路径和参数的来源站点提示。精确证据链通过包内的 Report、判断修订、Signal 与来源版本稳定身份回查。Agent token 不写入领域快照、日志或下载包。

## 验证

```bash
npm run typecheck
npm run test:e2e
npm run build
```

浏览器验收从空白临时数据目录启动真实 Radar 进程，只通过公开 Web 界面驱动 Project、来源采集、Agent 判断和 Report 生成，并验证进程重启后的持久化。

从干净检出复现完整主链、检查下载包并安全清理临时数据，见[贡献者 walking skeleton 验收手册](docs/contributing/walking-skeleton.md)。
