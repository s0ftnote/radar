import { radarDataDirectory } from "../lib/data-directory.js";
import { readRuntime } from "../lib/service-runtime.js";

export class RadarUnreachableError extends Error {
  constructor(detail: string) {
    super(`${detail}\n先在另一个终端运行 \`radar up\`（数据目录：${radarDataDirectory()}）。`);
    this.name = "RadarUnreachableError";
  }
}

/**
 * CLI 是 Radar 服务的瘦客户端，自己不碰 SQLite（ADR 0012）。
 * 服务在哪个端口由数据目录里的 service.json 说了算；够不到就如实报错。
 */
export async function callRadar(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const runtime = readRuntime(radarDataDirectory());
  if (!runtime || !runtime.port) throw new RadarUnreachableError("Radar 服务没有在运行。");

  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: init.method ?? "GET",
      // 一律标成 JSON。浏览器跨站发不出这个 content-type，服务端的同源校验
      // 因此只拦得住表单，拦不到 CLI——没带 content-type 的请求会被当成表单。
      headers: { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new RadarUnreachableError(
      `连不上 127.0.0.1:${runtime.port} 上的 Radar 服务：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Radar 服务返回 HTTP ${response.status}。`;
    throw new Error(message);
  }
  return payload;
}

/** judge 与 feedback 的正文是多行文本，走 stdin 而不是命令行参数（ADR 0012）。 */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}
