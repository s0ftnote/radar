import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDirectory = resolve(process.env.RADAR_DATA_DIR ?? ".radar");

try {
  mkdirSync(dataDirectory, { recursive: true });
  const startupDatabase = new DatabaseSync(resolve(dataDirectory, "radar.sqlite"), { timeout: 5_000 });
  startupDatabase.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS radar_startup_probe (id INTEGER) STRICT;
    DROP TABLE radar_startup_probe;
  `);
  startupDatabase.close();
} catch (error) {
  console.error(`[Radar] 无法准备可写的本地数据目录 ${dataDirectory}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`[Radar] 本地数据已就绪：${dataDirectory}`);
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
