import { randomUUID } from "node:crypto";
import { database } from "./database.js";
import { RadarDomainError } from "./domain-error.js";

export class UnknownEndpointError extends RadarDomainError {
  constructor(endpointId: string) {
    super(`找不到采集端点 ${endpointId}。`, 404);
  }
}

/** 来源状态：正常 / 最近失败 / 等推送。「够不着」不是来源状态，是渠道的配置状态。 */
export type SourceStatus = "normal" | "recently_failed" | "awaiting_push";

export type Endpoint = {
  id: string;
  channelId: string;
  channelName: string;
  channelConfigState: "ready" | "unlocked_by_config" | "unreachable";
  collectionIntervalSeconds: number;
  name: string;
  url: string;
  provenance: "factory" | "user";
  /** 出厂目录给的主题标签。建 Brief 时按它挑源，Radar 不解释它，只显示。 */
  topics: string[];
  licenseBasis: unknown;
  userDisabledAt: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
  status: SourceStatus;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  retryAfter: string | null;
  lastPushAt: string | null;
  collectingSince: string | null;
  /** 哪几条 Brief 把它纳入了。实例级采集与这个无关（ADR 0018）。 */
  includedInBriefs: Array<{ briefId: string; briefName: string }>;
};

type EndpointRow = {
  id: string;
  channel_id: string;
  channel_name: string;
  config_state: Endpoint["channelConfigState"];
  collection_interval_seconds: number;
  name: string;
  url: string;
  provenance: "factory" | "user";
  topics: string;
  license_basis: string | null;
  user_disabled_at: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  retry_after: string | null;
  last_push_at: string | null;
  collecting_since: string | null;
};

const endpointSelection = `
  SELECT endpoint.*, channel.name AS channel_name,
    channel.config_state, channel.collection_interval_seconds
  FROM endpoints AS endpoint
  JOIN channels AS channel ON channel.id = endpoint.channel_id
`;

export function listEndpoints(): Endpoint[] {
  const included = inclusionsByEndpoint();
  return (
    database().prepare(`${endpointSelection} ORDER BY endpoint.id`).all() as EndpointRow[]
  ).map((row) => mapEndpoint(row, included.get(row.id) ?? []));
}

export function getEndpoint(id: string): Endpoint | null {
  const row = database().prepare(`${endpointSelection} WHERE endpoint.id = ?`).get(id) as
    | EndpointRow
    | undefined;
  return row ? mapEndpoint(row, inclusionsByEndpoint().get(row.id) ?? []) : null;
}

/** 一次取回全部纳入关系，不按端点发查询。 */
function inclusionsByEndpoint(): Map<string, Array<{ briefId: string; briefName: string }>> {
  const rows = database()
    .prepare(
      `SELECT inclusion.endpoint_id, inclusion.brief_id, brief.name AS brief_name
         FROM brief_endpoint_inclusions AS inclusion
         JOIN briefs AS brief ON brief.id = inclusion.brief_id
        ORDER BY brief.created_at`,
    )
    .all() as Array<{ endpoint_id: string; brief_id: string; brief_name: string }>;
  const byEndpoint = new Map<string, Array<{ briefId: string; briefName: string }>>();
  for (const row of rows) {
    const list = byEndpoint.get(row.endpoint_id) ?? [];
    list.push({ briefId: row.brief_id, briefName: row.brief_name });
    byEndpoint.set(row.endpoint_id, list);
  }
  return byEndpoint;
}

/**
 * 停用有两个互不覆盖的字段。停用是人或 Agent 写下的决定——Radar 自己观察到的
 * 失败只导致退避，永不自动下架（ADR 0010）。
 */
export function isCollectable(endpoint: Endpoint): boolean {
  return isEnabled(endpoint) && endpoint.channelConfigState === "ready";
}

/** 实例级开着：用户没停用，目录也没退役。这两个决定互不覆盖。 */
export function isEnabled(endpoint: Endpoint): boolean {
  return endpoint.userDisabledAt === null && endpoint.retiredAt === null;
}

/**
 * 到点了没：渠道级节奏说了算，不做端点级覆盖（#44）。定时巡视与 `radar
 * collect` 走同一个判定——催一次采集不绕过渠道速率限制。
 *
 * 只管节奏，不管退避：退避是另一件事，由 `collectEndpoint` 自己说，那样跳过
 * 的理由才不会被这里含糊成「还没到点」。
 */
export function isDue(endpoint: Endpoint, now = new Date()): boolean {
  if (!endpoint.lastSuccessAt) return true;
  return (
    now.getTime() - Date.parse(endpoint.lastSuccessAt) >= endpoint.collectionIntervalSeconds * 1_000
  );
}

/** 正在退避里：连续失败之后 Radar 自己压住的下一次采集时间还没到（ADR 0010）。 */
export function isBackingOff(endpoint: Endpoint, now = new Date()): boolean {
  return endpoint.retryAfter !== null && Date.parse(endpoint.retryAfter) > now.getTime();
}

/**
 * 「被这个 Brief 纳入」的唯一定义，给 SQL 用。`brief_id` 由调用处提供，
 * 让 queue.ts 里的查询和这里说的是同一件事。
 */
export const includedInBriefSql = (briefIdExpression: string): string =>
  `SELECT endpoint_id FROM brief_endpoint_inclusions WHERE brief_id = ${briefIdExpression}`;

/**
 * 这个 Brief 要入队的端点：实例级开着就入。**纳入不在这里生效**——纳入是读侧
 * 的事。入队时就把它挡掉会让没纳入那段时间的内容从来没入过队，之后纳入它也
 * 回不来，那就是丢弃了（ADR 0010：只排序不丢弃）。
 */
export function listEndpointsToEnqueue(): Endpoint[] {
  return listEndpoints().filter(isEnabled);
}

/**
 * 用户自己登记一条端点。`provenance` 标成 `user`——那是升级对账唯一要用的
 * 区分：出厂目录只碰自己那批，用户加的一律不碰（ADR 0014）。
 */
export function registerUserEndpoint(input: {
  channelId: string;
  name: string;
  url: string;
}): Endpoint {
  const existing = database()
    .prepare("SELECT id FROM endpoints WHERE url = ?")
    .get(input.url) as { id: string } | undefined;
  if (existing) {
    throw new RadarDomainError(`这个地址已经登记过了，端点 ${existing.id}。`, 409);
  }

  const id = randomUUID();
  database()
    .prepare(
      `INSERT INTO endpoints (id, channel_id, name, url, provenance, created_at)
       VALUES (?, ?, ?, ?, 'user', ?)`,
    )
    .run(id, input.channelId, input.name, input.url, new Date().toISOString());
  return getEndpoint(id)!;
}

/**
 * 实例级停用：Radar 真的不再采它。写进的是「用户停用」字段，不碰「目录退役」
 * 字段——共用一个会让升级对账把用户手动停掉的源重新打开。
 */
export function setUserDisabled(endpointId: string, disabled: boolean): Endpoint {
  const changed = database()
    .prepare("UPDATE endpoints SET user_disabled_at = ? WHERE id = ?")
    .run(disabled ? new Date().toISOString() : null, endpointId);
  if (changed.changes === 0) throw new UnknownEndpointError(endpointId);
  return getEndpoint(endpointId)!;
}

/**
 * Brief 级纳入：这条 Brief 只看它纳入的端点，实例级采集照旧（ADR 0018）。
 * 移出只是这条 Brief 不再看它——代次不删，重新纳入时原样回来。
 */
export function setBriefInclusion(
  briefId: string,
  endpointId: string,
  included: boolean,
  reason?: string,
): void {
  const db = database();
  if (!included) {
    db.prepare(
      "DELETE FROM brief_endpoint_inclusions WHERE brief_id = ? AND endpoint_id = ?",
    ).run(briefId, endpointId);
    return;
  }
  if (!getEndpoint(endpointId)) throw new UnknownEndpointError(endpointId);
  db.prepare(
    `INSERT INTO brief_endpoint_inclusions (brief_id, endpoint_id, included_at, reason)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(brief_id, endpoint_id) DO UPDATE SET reason = excluded.reason`,
  ).run(briefId, endpointId, new Date().toISOString(), reason ?? null);
}

/** 这条 Brief 纳入了哪些端点。带上名字与 topics，省得再查一遍来源。 */
export function listBriefInclusions(
  briefId: string,
): Array<{
  endpointId: string;
  name: string;
  topics: string[];
  includedAt: string;
  reason: string | null;
}> {
  const rows = database()
    .prepare(
      `SELECT inclusion.endpoint_id, endpoint.name, endpoint.topics, inclusion.included_at,
              inclusion.reason
         FROM brief_endpoint_inclusions AS inclusion
         JOIN endpoints AS endpoint ON endpoint.id = inclusion.endpoint_id
        WHERE inclusion.brief_id = ? ORDER BY inclusion.endpoint_id`,
    )
    .all(briefId) as Array<{
    endpoint_id: string;
    name: string;
    topics: string;
    included_at: string;
    reason: string | null;
  }>;
  return rows.map((row) => ({
    endpointId: row.endpoint_id,
    name: row.name,
    topics: JSON.parse(row.topics) as string[],
    includedAt: row.included_at,
    reason: row.reason,
  }));
}


function mapEndpoint(
  row: EndpointRow,
  includedInBriefs: Array<{ briefId: string; briefName: string }>,
): Endpoint {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    channelConfigState: row.config_state,
    collectionIntervalSeconds: row.collection_interval_seconds,
    name: row.name,
    url: row.url,
    provenance: row.provenance,
    topics: JSON.parse(row.topics) as string[],
    licenseBasis: row.license_basis ? (JSON.parse(row.license_basis) as unknown) : null,
    userDisabledAt: row.user_disabled_at,
    retiredAt: row.retired_at,
    retiredReason: row.retired_reason,
    status: sourceStatus(row),
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    retryAfter: row.retry_after,
    lastPushAt: row.last_push_at,
    collectingSince: row.collecting_since,
    includedInBriefs,
  };
}

/**
 * 「够不着」不是来源状态，它是采集渠道的配置状态。`等推送` 也不是故障——
 * 那个渠道的内容本来就由 Agent 推来（ADR 0011）。
 */
function sourceStatus(row: EndpointRow): SourceStatus {
  if (row.config_state === "unlocked_by_config") return "awaiting_push";
  return row.consecutive_failures > 0 ? "recently_failed" : "normal";
}
