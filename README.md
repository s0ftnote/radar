# Radar

Radar 是一个开源、本地优先的个人情报工作台。当前 walking skeleton 从 Radar Project 和首个 Radar Brief 修订开始，所有数据保存在你控制的设备上。

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

停止进程后再次运行同一命令，Radar Projects 与 Radar Brief 修订会从该目录恢复。

## 验证

```bash
npm run typecheck
npm run test:e2e
npm run build
```

浏览器验收从空白临时数据目录启动真实 Radar 进程，只通过公开 Web 界面创建、列出、打开 Project，并验证进程重启后的持久化。
