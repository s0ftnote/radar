import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { closeDatabase, database } from "../lib/database.js";
import { radarDataDirectory } from "../lib/data-directory.js";
import { factoryCatalogPath, installFactoryCatalog, readFactoryCatalog } from "../lib/catalog.js";
import { createRadarApp } from "./app.js";
import { packageRoot } from "./package-root.js";
import { startScheduler, type Scheduler } from "./scheduler.js";
import { claimDataDirectory, defaultPort, type DataDirectoryClaim } from "../lib/service-runtime.js";

export type RadarService = { port: number; stop(): Promise<void> };

/**
 * 起一个只听 loopback 的常驻服务。它抢下数据目录、打开 SQLite（唯一写者）、
 * 绑端口，然后把端口登记到数据目录里给 CLI 用。
 */
export async function startRadarService(options: { port?: number } = {}): Promise<RadarService> {
  const requestedPort = options.port ?? defaultPort;
  const claim: DataDirectoryClaim = await claimDataDirectory(radarDataDirectory());

  let server: Server;
  let scheduler: Scheduler;
  try {
    database();
    // 出厂来源目录随版本走，不在线拉取（ADR 0014）。
    installFactoryCatalog(readFactoryCatalog(factoryCatalogPath(packageRoot())));
    server = await listen(requestedPort);
    scheduler = startScheduler();
  } catch (error) {
    closeDatabase();
    claim.release();
    throw error;
  }

  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : requestedPort;
  claim.publish(port);

  let stopped: Promise<void> | undefined;
  return {
    port,
    stop: () => (stopped ??= shutdown(server, scheduler, claim)),
  };
}

function listen(port: number): Promise<Server> {
  return new Promise((resolveListen, rejectListen) => {
    // 只绑 127.0.0.1：Radar 是本地实例，不该出现在任何外部网卡上。
    // 没要 HTTP/2，serve() 给的就是一个 node:http Server。
    const server = serve({ fetch: createRadarApp().fetch, hostname: "127.0.0.1", port }, () =>
      resolveListen(server),
    ) as Server;
    server.once("error", rejectListen);
  });
}

async function shutdown(
  server: Server,
  scheduler: Scheduler,
  claim: DataDirectoryClaim,
): Promise<void> {
  scheduler.stop();
  const closed = new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  // 不等 keep-alive 连接自己断——Ctrl-C 之后端口要立刻还回去。
  server.closeIdleConnections();
  const grace = setTimeout(() => server.closeAllConnections(), 500);
  try {
    await closed;
  } finally {
    clearTimeout(grace);
    closeDatabase();
    claim.release();
  }
}
