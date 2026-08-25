import { database } from "./database.js";

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
  return (database().prepare(`${endpointSelection} ORDER BY endpoint.id`).all() as EndpointRow[]).map(
    mapEndpoint,
  );
}

export function getEndpoint(id: string): Endpoint | null {
  const row = database().prepare(`${endpointSelection} WHERE endpoint.id = ?`).get(id) as
    | EndpointRow
    | undefined;
  return row ? mapEndpoint(row) : null;
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

/** 正在退避里：连续失败之后 Radar 自己压住的下一次采集时间还没到（ADR 0010）。 */
export function isBackingOff(endpoint: Endpoint, now = new Date()): boolean {
  return endpoint.retryAfter !== null && Date.parse(endpoint.retryAfter) > now.getTime();
}

/** 这个 Brief 现在看得见的端点：实例级开着就看得见。 */
export function listEndpointsVisibleToBrief(_briefId: string): Endpoint[] {
  return listEndpoints().filter(isEnabled);
}

function mapEndpoint(row: EndpointRow): Endpoint {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    channelConfigState: row.config_state,
    collectionIntervalSeconds: row.collection_interval_seconds,
    name: row.name,
    url: row.url,
    provenance: row.provenance,
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
