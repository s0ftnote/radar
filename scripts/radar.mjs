import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const dataDirectory = resolve(process.env.RADAR_DATA_DIR ?? ".radar");

try {
  mkdirSync(dataDirectory, { recursive: true });
} catch (error) {
  console.error(`[Radar] 无法准备本地数据目录 ${dataDirectory}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`[Radar] 本地数据：${dataDirectory}`);
console.log("[Radar] 正在启动仅供本机访问的 Web 界面…");

const nextArguments = ["dev", "--hostname", "127.0.0.1", ...process.argv.slice(2)];
const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), ...nextArguments], {
  env: { ...process.env, RADAR_DATA_DIR: dataDirectory },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error("[Radar] Web 进程启动失败：", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
