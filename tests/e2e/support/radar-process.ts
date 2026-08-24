import { spawn, type ChildProcess } from "node:child_process";

export async function startRadar(dataDirectory: string, port = 33123): Promise<ChildProcess> {
  const child = spawn("npm", ["run", "radar", "--", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, RADAR_DATA_DIR: dataDirectory, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
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
      const response = await fetch(`http://127.0.0.1:${port}`);
      if (response.ok) return child;
    } catch {
      // The loopback listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  await stopRadar(child);
  throw new Error(`Timed out waiting for Radar.\n${diagnostics}`);
}

export async function stopRadar(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => process.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
}
