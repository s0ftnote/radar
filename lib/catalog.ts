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
 * 升级对账。目录随版本走，所以版本号没变就什么都不做——这也让每次启动不
 * 白写一遍库（ADR 0014）。
 *
 * 对账认**永不复用的稳定 id，不认 URL**：端点搬家只是改 `url` 字段，那一行
 * 的历史、命中统计、退避状态原样接上。目录新增的自动加入并默认开；目录标了
 * `retired` 的写进「目录退役」那一格并带上理由，不删行、不碰用户自己的停用
 * 决定；`provenance = 'user'` 的一律不碰。
 *
 * 这里发生的全是「人写下的决定」——目录是人改的。Radar 自己观察到的失败只
 * 导致退避，从不走到这里（ADR 0010）。
 */
export function reconcileFactoryCatalog(catalog: FactoryCatalog): boolean {
  const db = database();
  const installed = db
    .prepare("SELECT value FROM instance_settings WHERE key = 'catalog_version'")
    .get() as { value: string } | undefined;
  if (installed && Number(installed.value) === catalog.catalogVersion) return false;

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
      ).run(channel.id, channel.name, channel.configState, channel.collectionIntervalSeconds, now);
    }

    for (const endpoint of catalog.endpoints) {
      const url = urlToWrite(endpoint);
      // 用户早就自己登记过这个地址，而目录这一条还没进过库：他那条正在采着
      // 同一个东西，让它采。用户加的一律不碰，也不能让对账在启动时炸掉。
      if (url === null) continue;
      db.prepare(
        `INSERT INTO endpoints
          (id, channel_id, name, url, provenance, license_basis, retired_at, retired_reason,
           created_at)
         VALUES (?, ?, ?, ?, 'factory', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           channel_id = excluded.channel_id,
           name = excluded.name,
           url = ?,
           license_basis = excluded.license_basis,
           -- 退役时间记的是第一次读到这条退役的时候，后面再对账不往前推。
           retired_at = CASE
             WHEN excluded.retired_at IS NULL THEN NULL
             ELSE COALESCE(endpoints.retired_at, excluded.retired_at)
           END,
           retired_reason = excluded.retired_reason
         WHERE endpoints.provenance = 'factory'`,
      ).run(
        endpoint.id,
        endpoint.channelId,
        endpoint.name,
        endpoint.url,
        JSON.stringify(endpoint.licenseBasis),
        endpoint.retired ? now : null,
        endpoint.retired ?? null,
        now,
        url,
      );
    }

    db.prepare(
      `INSERT INTO instance_settings (key, value) VALUES ('catalog_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(catalog.catalogVersion));
  });
  return true;
}

/**
 * `url` 上有唯一约束，而用户可能早就自己登记过同一个地址。撞上那种行时：
 * 已经在库里的端点保留原来的 url，还没进库的这次就不进。用户加的那条一律
 * 不碰，也不能让整场对账在启动时炸掉。
 */
function urlToWrite(endpoint: CatalogEndpoint): string | null {
  const taken = database()
    .prepare("SELECT id FROM endpoints WHERE url = ? AND id <> ?")
    .get(endpoint.url, endpoint.id) as { id: string } | undefined;
  if (!taken) return endpoint.url;
  const current = database()
    .prepare("SELECT url FROM endpoints WHERE id = ?")
    .get(endpoint.id) as { url: string } | undefined;
  // 已经在库里的就保留原地址（搬家撞上了用户那条），还没进库的这次就不进。
  return current?.url ?? null;
}
