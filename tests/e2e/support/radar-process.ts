import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

export const repositoryRoot = resolve(import.meta.dirname, "../../..");

export type RunningRadar = { process: ChildProcess; port: number; output(): string };

/**
 * 起一个真正的 `radar up`——验收的是装好之后用户敲的那条命令，
 * 不是一个测试专用的内嵌服务器。
 */
export type RadarEnvironment = { dataDirectory: string; catalogPath?: string };

export async function startRadar(
  dataDirectory: string,
  options: { port?: number; command?: string[]; cwd?: string; catalogPath?: string } = {},
): Promise<RunningRadar> {
  const port = options.port ?? 33123;
  const [executable, ...argv] = options.command ?? [
    process.execPath,
    resolve(repositoryRoot, "dist/cli/main.js"),
  ];
  const child = spawn(executable!, [...argv, "up", "--port", String(port)], {
    cwd: options.cwd ?? repositoryRoot,
    env: radarEnv({ dataDirectory, catalogPath: options.catalogPath }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk) => (output += chunk.toString()));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Radar 起来之前就退出了。\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return { process: child, port, output: () => output };
    } catch {
      // loopback 还没听上。
    }
    await delay(100);
  }

  await stopRadar({ process: child, port, output: () => output });
  throw new Error(`等 Radar 起来超时。\n${output}`);
}

export async function stopRadar(radar: RunningRadar, signal: NodeJS.Signals = "SIGINT"): Promise<void> {
  if (radar.process.exitCode === null && radar.process.signalCode === null) {
    radar.process.kill(signal);
    await Promise.race([once(radar.process, "exit"), delay(10_000)]);
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!(await portIsListening(radar.port))) return;
    await delay(100);
  }
  throw new Error(`Radar 没有释放 loopback 端口 ${radar.port}。\n${radar.output()}`);
}

export async function portIsListening(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`);
    return true;
  } catch {
    return false;
  }
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export function radarEnv(environment: RadarEnvironment): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, RADAR_DATA_DIR: environment.dataDirectory };
  if (environment.catalogPath) env.RADAR_CATALOG = environment.catalogPath;
  else delete env.RADAR_CATALOG;
  return env;
}

export type CliRun = { stdout: string; stderr: string; code: number };

/** 敲一条 `radar …`，可选地从 stdin 喂正文——那正是 Skill 会做的事（ADR 0012）。 */
export function radar(
  environment: RadarEnvironment,
  argv: string[],
  stdin = "",
): Promise<CliRun> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [resolve(repositoryRoot, "dist/cli/main.js"), ...argv], {
      cwd: repositoryRoot,
      env: radarEnv(environment),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.stdin.end(stdin);
    child.on("close", (code) => resolveRun({ stdout, stderr, code: code ?? 0 }));
  });
}

/** 跑一条取数据的命令并解析它的 JSON；非零退出就把 stderr 抛出来。 */
export async function radarJson<T>(
  environment: RadarEnvironment,
  argv: string[],
  stdin = "",
): Promise<T> {
  const run = await radar(environment, argv, stdin);
  if (run.code !== 0) throw new Error(`radar ${argv.join(" ")} 失败：${run.stderr || run.stdout}`);
  return JSON.parse(run.stdout) as T;
}
