import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { database, inTransaction } from "./database.js";

export type CatalogChannel = {
  id: string;
  name: string;
  configState: "ready" | "unlocked_by_config" | "unreachable";
  collectionIntervalSeconds: number;
};

export type CatalogEndpoint = {
  id: string;
  channelId: string;
  name: string;
  url: string;
  licenseBasis: unknown;
  /** 下架用一句理由，不要删行——端点 id 永不复用（ADR 0014）。 */
  retired?: string;
};

export type FactoryCatalog = {
  catalogVersion: number;
  channels: CatalogChannel[];
  endpoints: CatalogEndpoint[];
};

/**
 * 出厂来源目录是仓库里的一个数据文件，随版本走，不在线拉取（ADR 0014）。
 * `RADAR_CATALOG` 指向另一个目录文件，验收用它换掉线上端点。
 */
export function factoryCatalogPath(packageRoot: string): string {
  return process.env.RADAR_CATALOG
    ? resolve(process.env.RADAR_CATALOG)
    : resolve(packageRoot, "data/factory-catalog.json");
}

export function readFactoryCatalog(path: string): FactoryCatalog {
  return JSON.parse(readFileSync(path, "utf8")) as FactoryCatalog;
}

/**
 * 把目录里的渠道与端点装进这个实例。认 id 不认 url——id 永不复用，端点搬家
 * 只是改 url 字段（ADR 0014）。
 */
export function installFactoryCatalog(catalog: FactoryCatalog): void {
  const db = database();
  const now = new Date().toISOString();

  inTransaction(() => {
    for (const channel of catalog.channels) {
      db.prepare(
        `INSERT INTO channels (id, name, config_state, collection_interval_seconds, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           config_state = excluded.config_state,
           collection_interval_seconds = excluded.collection_interval_seconds`,
      ).run(
        channel.id,
        channel.name,
        channel.configState,
        channel.collectionIntervalSeconds,
        now,
      );
    }

    for (const endpoint of catalog.endpoints) {
      db.prepare(
        `INSERT INTO endpoints
          (id, channel_id, name, url, provenance, license_basis, retired_at, retired_reason,
           created_at)
         VALUES (?, ?, ?, ?, 'factory', ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(
        endpoint.id,
        endpoint.channelId,
        endpoint.name,
        endpoint.url,
        JSON.stringify(endpoint.licenseBasis),
        endpoint.retired ? now : null,
        endpoint.retired ?? null,
        now,
      );
    }

    db.prepare(
      `INSERT INTO instance_settings (key, value) VALUES ('catalog_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(catalog.catalogVersion));
  });
}
