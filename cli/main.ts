#!/usr/bin/env node
import { radarDataDirectory } from "../lib/data-directory.js";
import { DataDirectoryBusyError, defaultPort } from "../lib/service-runtime.js";
import { radarVersion } from "../server/version.js";
import { callRadar } from "./client.js";

const usage = `radar — 本地信号聚合站

用法
  radar up [--port <端口>]   在本机起 Radar 服务，Ctrl-C 停止
  radar status               看本机 Radar 服务的状态
  radar --help               显示这份说明
  radar --version            显示版本号

环境变量
  RADAR_DATA_DIR             本地数据目录，默认 ~/.radar
`;

await main(process.argv.slice(2));

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(usage);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${radarVersion()}\n`);
    return;
  }

  try {
    if (command === "up") return await up(rest);
    if (command === "status") return await status();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  fail(`不认识的命令 \`${command}\`。用 \`radar --help\` 看命令面。`);
}

async function up(argv: string[]): Promise<void> {
  const port = readPort(argv);
  // 只有 `radar up` 需要服务端模块——它一加载就打开 SQLite，别的命令不该碰。
  const { startRadarService } = await import("../server/service.js");
  let service;
  try {
    service = await startRadarService({ port });
  } catch (error) {
    if (error instanceof DataDirectoryBusyError) fail(error.message);
    throw error;
  }

  process.stdout.write(`[Radar] 本地数据目录：${radarDataDirectory()}\n`);
  process.stdout.write(`[Radar] 来源页：http://127.0.0.1:${service.port}\n`);
  process.stdout.write("[Radar] Ctrl-C 停止。\n");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      process.stdout.write(`\n[Radar] 收到 ${signal}，正在停止…\n`);
      void service.stop().then(() => process.exit(0));
    });
  }
}

async function status(): Promise<void> {
  const health = (await callRadar("/health")) as { version: string; dataDirectory: string };
  process.stdout.write(`Radar ${health.version} 正在运行，数据目录 ${health.dataDirectory}\n`);
}

function readPort(argv: string[]): number {
  const index = argv.indexOf("--port");
  if (index === -1) return defaultPort;
  const port = Number(argv[index + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) fail("`--port` 需要一个 0–65535 的端口号。");
  return port;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
