import { collectEndpoint } from "../lib/acquisition.js";
import { isBackingOff, isCollectable, listEndpoints, type Endpoint } from "../lib/endpoints.js";

export type Scheduler = { stop(): void };

/** 看一眼有没有端点到点了的最长间隔。比最快的渠道还慢就没意义了。 */
const maximumTickSeconds = 30;

/**
 * 装好即用渠道由 Radar 自己按计划采集（ADR 0011）：服务起来立刻首采，
 * 此后按渠道级节奏。防重入与退避都在 `collectEndpoint` 里，这里只管催。
 */
export function startScheduler(): Scheduler {
  let running = false;
  let stopped = false;

  const sweep = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      for (const endpoint of listEndpoints()) {
        if (stopped) break;
        if (!isCollectable(endpoint) || !isDue(endpoint)) continue;
        const result = await collectEndpoint(endpoint.id);
        if (result.status === "failed") {
          console.error(`[Radar] 采集 ${endpoint.id} 失败：${result.error}`);
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void sweep(), tickSeconds() * 1_000);
  timer.unref();
  void sweep();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function tickSeconds(): number {
  const intervals = listEndpoints().map((endpoint) => endpoint.collectionIntervalSeconds);
  return Math.max(1, Math.min(maximumTickSeconds, ...intervals));
}

function isDue(endpoint: Endpoint): boolean {
  const now = Date.now();
  if (isBackingOff(endpoint)) return false;
  if (!endpoint.lastSuccessAt) return true;
  return now - Date.parse(endpoint.lastSuccessAt) >= endpoint.collectionIntervalSeconds * 1_000;
}
