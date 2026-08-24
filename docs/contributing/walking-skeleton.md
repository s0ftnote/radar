# 复现 Radar walking skeleton

这份手册用于从干净检出复现当前唯一的 Radar 主链：Radar Project 与 Radar Brief → 本地 HTTP RSS/Atom → 来源版本 → Agent 判断 → Signal 与情报条目 → 固定快照 Report → 自动 HTML 平台物料包 → 离线检查与重启恢复。

它不使用数据库写入、内部服务函数、测试后门或第二套应用启动方式。自动验收和手动操作都通过 `npm run radar` 启动真实 Web 进程，并只从公开 Web 界面推进领域状态。

## 前置条件

- Git；
- Node.js 24.14 或更高版本；
- npm；
- Chromium 运行依赖。首次运行浏览器验收时，可执行 `npx playwright install chromium`；
- 手动复现时，一个可从本机访问的 HTTP RSS/Atom URL，以及一个符合 [README Agent 边界](../../README.md#本地-agent-适配器)的 HTTP JSON Agent endpoint。

## 从干净检出运行自动全链验收

```bash
git clone https://github.com/2093686099/radar.git
cd radar
npm install
npx playwright install chromium
npm run test:e2e -- tests/e2e/walking-skeleton.spec.ts
```

这条测试会自行启动两个只监听 loopback 的确定性 HTTP fixture：一个 RSS feed 和一个同时支持 `judge`、`generate_report` 的 Agent。随后它创建空白临时数据目录，并通过测试支持代码调用正式的 `npm run radar -- --port 33123`。测试结束后会停止所有进程并删除临时数据和解压目录。

预期终端结果：

```text
1 passed
```

完整回归使用：

```bash
npm run typecheck
npm run test:e2e
npm run build
```

## 手动复现

### 1. 准备一次性的本地数据位置

```bash
RADAR_ACCEPTANCE_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/radar-walking-skeleton.XXXXXX")"
printf 'Radar data: %s\n' "$RADAR_ACCEPTANCE_DATA_DIR"
```

保留终端打印的绝对路径。后续重启必须继续使用同一个目录，才能验证持久化。

### 2. 启动来源和 Agent

准备一个可公开读取的本地 HTTP RSS/Atom endpoint，例如 `http://127.0.0.1:4100/feed`。Feed 至少包含一项带标题、正文或摘要、稳定外部身份和发布时间的 entry。

另行启动一个本地 Agent endpoint。它需要接受 `POST`，检查可选 Bearer token，并根据 `x-radar-operation` 处理：

- `judge`：返回匹配结果、稳定 `judgmentKey`、判断、理由和能在来源标题或正文中精确找到的证据摘录；
- `generate_report`：为每个选中情报修订返回至少一项主张，且只引用请求中的情报修订和 Signal 身份。

完整请求与响应结构见 [README](../../README.md#本地-agent-适配器)。仓库浏览器验收使用的确定性实现位于 `tests/e2e/support/feed-fixture.ts` 和 `tests/e2e/support/report-agent-fixture.ts`；它们由 Playwright 场景管理，不构成另一条 Radar 启动路径。

### 3. 用唯一主要命令启动 Radar

```bash
RADAR_DATA_DIR="$RADAR_ACCEPTANCE_DATA_DIR" \
RADAR_AGENT_ENDPOINT=http://127.0.0.1:8787/agent \
RADAR_AGENT_TOKEN=replace-with-your-local-token \
npm run radar
```

预期终端会打印数据目录，并把 Web 界面绑定到 `http://127.0.0.1:3000`。不要把 token 填进 Radar Brief、来源 URL 或任何页面字段。

### 4. 只通过 Web 界面跑通主链

1. 打开 `http://127.0.0.1:3000`。空白实例显示“还没有 Radar Project”。
2. 填写 Project 名称和 Radar Brief，创建后打开该 Project。
3. 确认 Source Network、Radar 判断、Reports 和 HTML 平台物料包分别显示有效 empty 状态，而不是错误。
4. 在“公开 RSS/Atom URL”中输入本地 feed URL，点击“验证并保存”。操作中按钮显示“正在验证…”，成功后显示来源卡片。
5. 点击来源卡片中的“采集…”。操作中按钮显示“正在采集…”，成功后显示新增来源版本及获取时间。
6. 点击“运行 Radar 判断”。操作中按钮显示“正在判断…”，成功后情报条目同时显示判断、证据摘录、Signal、Source Network 来源、来源内容、来源版本和 Radar Brief 修订。
7. 在 Reports 区选择该情报修订，填写内容目的、目标受众和核心角度，只点击一次“生成 Report”。
8. 操作中按钮显示“正在生成 Report…”。成功后应分别看到拥有独立身份的固定快照 Report 与 HTML 平台物料包，以及一次成功的 HTML 包生成运行；不需要第二个主流程动作。
9. 在物料包卡片内确认 iframe 能读取标题、主张、PNG 替代文字和“完整引用”，然后点击“下载完整 ZIP”。

失败状态也必须保持可检查：来源验证/采集、Agent 判断、Report Agent 和 HTML 包写入失败分别显示原因与适用的恢复入口；有效无匹配仍是成功完成而不是失败。完整浏览器套件中的 `sources.spec.ts`、`intelligence.spec.ts`、`reports.spec.ts` 和 `material-packages.spec.ts` 覆盖这些状态。

### 5. 检查下载包

```bash
mkdir -p /tmp/radar-package-check
unzip -q /absolute/path/to/radar-html-package-*.zip -d /tmp/radar-package-check
find /tmp/radar-package-check -maxdepth 2 -type f | sort
```

至少应看到：

- `index.html` 与 `assets/styles.css`；
- `assets/preview.png`、本地字体及许可证；
- `editorial.json` 与 `render-source.json`；
- `provenance.html`、`provenance.json` 与 `asset-provenance.json`；
- `capability-snapshot.json` 与 `manifest.json`。

断开网络或停止 Radar 后，直接在浏览器中打开解压后的 `index.html`。页面仍应语义化可读，并显示固定身份、完整引用、来源版本身份和 PNG 替代文字；开发者工具的 Network 面板不应出现远程运行时资产请求。`manifest.json` 中的 `entrypoint`、Report 修订、section 路径、文件字节数和 SHA-256 应与实际文件一致。

### 6. 验证重启恢复

在运行 Radar 的终端按 `Ctrl-C`，再以第 3 步完全相同的环境变量和 `npm run radar` 重启。重新打开 Project 后，确认以下内容仍可检查：

- Radar Brief 和来源版本；
- Signal、证据摘录、情报条目及其修订；
- Report 身份、固定输入和可追溯主张；
- 物料包身份、生成运行、iframe 预览、下载入口和完整出处链。

### 7. 清理本地数据

先停止 Radar。确认变量仍指向第 1 步创建的临时目录，再执行带路径约束的清理：

```bash
test -d "$RADAR_ACCEPTANCE_DATA_DIR" &&
  [[ "$RADAR_ACCEPTANCE_DATA_DIR" == "${TMPDIR:-/tmp}"/radar-walking-skeleton.* ]] &&
  rm -rf -- "$RADAR_ACCEPTANCE_DATA_DIR"
```

若约束不匹配，命令不会删除任何内容；请回到第 1 步打印的绝对路径核对，不要扩大删除范围。
