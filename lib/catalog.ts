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
export function reconcileFactoryCatalog(catalog: FactoryCatalog): void {
  const db = database();
  const installed = db
    .prepare("SELECT value FROM instance_settings WHERE key = 'catalog_version'")
    .get() as { value: string } | undefined;
  if (installed && Number(installed.value) === catalog.catalogVersion) return;

  const now = new Date().toISOString();
  let deferred = 0;
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
      // 地址被别的行占着就整条先放着不动：认 id 不认 URL，但 url 上有唯一
      // 约束，硬写会让整场对账在启动时炸掉；只改一半又会留下一行采着死地址
      // 的端点。这一轮不动它，也不记版本号，下次起服务再对一次。
      if (urlTakenByAnother(endpoint)) {
        deferred += 1;
        continue;
      }
      db.prepare(
        `INSERT INTO endpoints
          (id, channel_id, name, url, provenance, license_basis, retired_at, retired_reason,
           created_at)
         VALUES (?, ?, ?, ?, 'factory', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           channel_id = excluded.channel_id,
           name = excluded.name,
           url = excluded.url,
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
      );
    }

    // 有端点这一轮没对上，就不记下版本号：下次起服务再对一次，等那个地址
    // 腾出来它自然就跟上了。记了版本号等于让它永远跟不上。
    if (deferred === 0) {
      db.prepare(
        `INSERT INTO instance_settings (key, value) VALUES ('catalog_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(String(catalog.catalogVersion));
    }
  });
}

/** 这个地址已经被另一行占着——用户自己登记过，或者另一条出厂端点还没搬走。 */
function urlTakenByAnother(endpoint: CatalogEndpoint): boolean {
  const taken = database()
    .prepare("SELECT id FROM endpoints WHERE url = ? AND id <> ?")
    .get(endpoint.url, endpoint.id) as { id: string } | undefined;
  return taken !== undefined;
}
