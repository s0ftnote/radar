import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const defaultPort = 33123;

export type RadarRuntime = { pid: number; port: number; startedAt: string };

/**
 * 一个数据目录只允许一个 Radar 服务——它是 SQLite 的唯一写者。
 * 这个文件同时是排他锁与 CLI 找到服务的方式：`wx` 独占创建保证抢锁是原子的。
 */
export function runtimeFilePath(dataDirectory: string): string {
  return resolve(dataDirectory, "service.json");
}

export function readRuntime(dataDirectory: string): RadarRuntime | null {
  let raw: string;
  try {
    raw = readFileSync(runtimeFilePath(dataDirectory), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RadarRuntime>;
    if (typeof parsed.pid !== "number" || typeof parsed.port !== "number") return null;
    return { pid: parsed.pid, port: parsed.port, startedAt: String(parsed.startedAt ?? "") };
  } catch {
    return null;
  }
}

export class DataDirectoryBusyError extends Error {
  constructor(readonly holder: RadarRuntime) {
    super(
      `这个数据目录已经有一个 Radar 服务在用（pid ${holder.pid}，端口 ${holder.port}）。` +
        "一个数据目录只能有一个服务，先停掉它再起。",
    );
    this.name = "DataDirectoryBusyError";
  }
}

export type DataDirectoryClaim = {
  /** 端口是绑上之后才知道的，绑上再登记，CLI 才连得上。 */
  publish(port: number): void;
  release(): void;
};

/** 抢下数据目录；仍有 Radar 服务在用则抛 DataDirectoryBusyError。 */
export async function claimDataDirectory(dataDirectory: string): Promise<DataDirectoryClaim> {
  mkdirSync(dataDirectory, { recursive: true });
  const path = runtimeFilePath(dataDirectory);
  const claim: RadarRuntime = { pid: process.pid, port: 0, startedAt: new Date().toISOString() };

  try {
    writeFileSync(path, JSON.stringify(claim), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const holder = readRuntime(dataDirectory);
    if (holder && (await stillServing(holder))) throw new DataDirectoryBusyError(holder);
    // 上一个服务被 kill -9 了，锁是陈旧的。接手它。
    writeFileSync(path, JSON.stringify(claim));
    // 两个实例同时判定陈旧时最后写的那个赢；另一个在这里看见不是自己的 pid。
    const winner = readRuntime(dataDirectory);
    if (winner && winner.pid !== process.pid) throw new DataDirectoryBusyError(winner);
  }

  return {
    publish: (port) => writeFileSync(path, JSON.stringify({ ...claim, port })),
    release: () => {
      if (readRuntime(dataDirectory)?.pid === process.pid) rmSync(path, { force: true });
    },
  };
}

/**
 * 光看 pid 还活着不够——pid 会被系统回收，那会让一个陈旧的锁永远卡住数据目录。
 * 所以再问一次它登记的端口：答得上 /health 的才是真的还在服务。
 * `port` 为 0 说明持有者刚抢到锁、还没绑上端口，那也算在用。
 */
async function stillServing(holder: RadarRuntime): Promise<boolean> {
  if (!isProcessAlive(holder.pid)) return false;
  if (holder.port === 0) return true;
  try {
    const response = await fetch(`http://127.0.0.1:${holder.port}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
