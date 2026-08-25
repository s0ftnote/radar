import { spawn, type ChildProcess } from "node:child_process";

export async function startRadar(
  dataDirectory: string,
  port = 33123,
  environment: Record<string, string> = {},
): Promise<ChildProcess> {
  const child = spawn("npm", ["run", "radar", "--", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment, RADAR_DATA_DIR: dataDirectory, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  let diagnostics = "";
  child.stdout?.on("data", (chunk) => (diagnostics += chunk.toString()));
  child.stderr?.on("data", (chunk) => (diagnostics += chunk.toString()));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Radar exited before becoming ready.\n${diagnostics}`);
    }
    try {
      // Web 上已没有页面（ADR 0013），就绪探针改打一个 API 路由：
      // 空 body 必然被拒为 400，收到它即证明路由已编译、服务可写。
      const response = await fetch(`http://127.0.0.1:${port}/api/briefs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (response.status === 400) return child;
    } catch {
      // The loopback listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  await stopRadar(child);
  throw new Error(`Timed out waiting for Radar.\n${diagnostics}`);
}

export async function stopRadar(child: ChildProcess, port = 33123): Promise<void> {
  if (child.exitCode === null) {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      return;
    }
  }

  throw new Error(`Radar did not release loopback port ${port}.`);
}
