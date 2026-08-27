import { randomUUID } from "node:crypto";
import { database, inTransaction } from "./database.js";
import { RadarDomainError } from "./domain-error.js";
import {
  getEndpoint,
  isBackingOff,
  isDue,
  isEnabled,
  isIncluded,
  listEndpoints,
  UnknownEndpointError,
  type Endpoint,
} from "./endpoints.js";
import { fetchFeed, type FeedEntry } from "./feed.js";
import { enqueueForAllBriefs } from "./queue.js";

export type AcquisitionResult = {
  endpointId: string;
  status: "success" | "failed" | "skipped";
  newContentCount: number;
  seenContentCount: number;
  queuedCount: number;
  error?: string;
  skippedBecause?:
    | "already_collecting"
    | "backing_off"
    | "not_collectable"
    | "not_included"
    | "not_due"
    | "out_of_time";
};

/** 连续失败退避的上限。永不因失败自动下架端点（ADR 0010），只是越退越慢。 */
const maximumBackoffSeconds = 6 * 60 * 60;

/** 采集进程被 kill 之后 `collecting_since` 会留着；超过这个时长视为陈旧。 */
const staleCollectionSeconds = 15 * 60;

export async function collectEndpoint(
  endpointId: string,
  options: { force?: boolean } = {},
): Promise<AcquisitionResult> {
  const endpoint = getEndpoint(endpointId);
  if (!endpoint) throw new UnknownEndpointError(endpointId);

  const skip = whyNotNow(endpoint, options.force === true);
  if (skip) return skipped(endpointId, skip);

  const db = database();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  // 单端点防重入：抢下 collecting_since 才算真的开工。
  const claimed = db
    .prepare(
      `UPDATE endpoints SET collecting_since = ?
     WHERE id = ? AND (collecting_since IS NULL OR collecting_since < ?)`,
    )
    .run(startedAt, endpointId, staleBefore(startedAt));
  if (claimed.changes === 0) return skipped(endpointId, "already_collecting");

  db.prepare(
    "INSERT INTO acquisition_runs (id, endpoint_id, status, started_at) VALUES (?, ?, 'running', ?)",
  ).run(runId, endpointId, startedAt);

  try {
    const feed = await fetchFeed(endpoint.url);
    const completedAt = new Date().toISOString();
    const counts = inTransaction(() => {
      const created = persistBatch(endpointId, feed.entries, completedAt);
      db.prepare(
        `UPDATE endpoints SET
           name = CASE WHEN provenance = 'user' THEN ? ELSE name END,
           last_attempt_at = ?, last_success_at = ?, last_error = NULL,
           consecutive_failures = 0, retry_after = NULL, collecting_since = NULL
         WHERE id = ?`,
      ).run(feed.name, completedAt, completedAt, endpointId);
      db.prepare(
        `UPDATE acquisition_runs SET status = 'success', completed_at = ?,
           new_content_count = ?, seen_content_count = ? WHERE id = ?`,
      ).run(completedAt, created, feed.entries.length, runId);
      return { created, seen: feed.entries.length };
    });

    const queuedCount = enqueueForAllBriefs();
    return {
      endpointId,
      status: "success",
      newContentCount: counts.created,
      seenContentCount: counts.seen,
      queuedCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordFailure(endpoint, runId, message);
    return {
      endpointId,
      status: "failed",
      newContentCount: 0,
      seenContentCount: 0,
      queuedCount: 0,
      error: message,
    };
  }
}

function whyNotNow(endpoint: Endpoint, force: boolean): AcquisitionResult["skippedBecause"] | null {
  if (!isEnabled(endpoint) || endpoint.channelConfigState !== "ready") return "not_collectable";
  // 没有任何 Brief 要它就不采——说清是「没人要」而不是笼统的「采不了」，
  // 催采集的人才知道该去纳入它（#104）。
  if (!isIncluded(endpoint)) return "not_included";
  if (!force && isBackingOff(endpoint)) return "backing_off";
  // 「已经在采」不在这里判——下面那条原子 UPDATE 抢不到 collecting_since 才算数。
  return null;
}

function recordFailure(endpoint: Endpoint, runId: string, message: string): void {
  const db = database();
  const failedAt = new Date().toISOString();
  const failures = endpoint.consecutiveFailures + 1;
  const backoffSeconds = Math.min(
    endpoint.collectionIntervalSeconds * 2 ** (failures - 1),
    maximumBackoffSeconds,
  );
  inTransaction(() => {
    db.prepare(
      `UPDATE endpoints SET last_attempt_at = ?, last_error = ?, consecutive_failures = ?,
         retry_after = ?, collecting_since = NULL WHERE id = ?`,
    ).run(
      failedAt,
      message,
      failures,
      new Date(Date.parse(failedAt) + backoffSeconds * 1_000).toISOString(),
      endpoint.id,
    );
    db.prepare(
      "UPDATE acquisition_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?",
    ).run(failedAt, message, runId);
  });
}

/**
 * 身份用 feed 自带的 guid / external_id。同一条被编辑不是新内容——正文快照
 * 停在第一次采到的那一刻（ADR 0015），只把 last_seen_at 推到现在。
 */
function persistEntry(endpointId: string, entry: FeedEntry, seenAt: string): "created" | "seen" {
  const db = database();
  const existing = db
    .prepare("SELECT id FROM source_contents WHERE endpoint_id = ? AND external_id = ?")
    .get(endpointId, entry.externalId) as { id: string } | undefined;

  if (existing) {
    db.prepare("UPDATE source_contents SET last_seen_at = ? WHERE id = ?").run(seenAt, existing.id);
    // 正文快照定在采集当时不动（ADR 0015），热度是会变的那一面，跟着刷新。
    recordHotness(existing.id, entry.hotness);
    return "seen";
  }

  const contentId = randomUUID();
  db.prepare(
    `INSERT INTO source_contents
      (id, endpoint_id, external_id, title, author, body, origin_url, published_at,
       raw_json, acquired_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    contentId,
    endpointId,
    entry.externalId,
    entry.title,
    entry.author,
    entry.body,
    entry.originUrl,
    entry.publishedAt,
    entry.rawPayload,
    seenAt,
    seenAt,
  );
  recordHotness(contentId, entry.hotness);
  return "created";
}

/** 平台给了热度就记下来；没给就没有这一行，算分时按 0 处理。 */
function recordHotness(sourceContentId: string, hotness: number | undefined): void {
  if (typeof hotness !== "number") return;
  database()
    .prepare(
      `INSERT INTO source_content_hotness (source_content_id, hotness) VALUES (?, ?)
       ON CONFLICT(source_content_id) DO UPDATE SET hotness = excluded.hotness`,
    )
    .run(sourceContentId, hotness);
}

function staleBefore(now: string): string {
  return new Date(Date.parse(now) - staleCollectionSeconds * 1_000).toISOString();
}

const collectAllTimeoutMilliseconds = 60_000;

/**
 * 催一次全实例采集。同步返回，带 60 秒总超时（#45）——催的人在等着看结果，
 * 端点多起来一趟能走很久。到点之后不再开新的端点，剩下的如实标成「没轮到」：
 * 它们照样由调度器按渠道节奏采，超时不是失败，不进退避。
 *
 * **不绕过渠道速率限制**（#45）：没到渠道节奏的端点这一趟不采。点名某一条
 * 端点才越过退避，那是用户的显式决定。
 */
export async function collectAllEndpoints(): Promise<AcquisitionResult[]> {
  const deadline = Date.now() + collectAllTimeoutMilliseconds;
  const results: AcquisitionResult[] = [];
  for (const endpoint of listEndpoints()) {
    // 退避中的端点照样交给 collectEndpoint 说「在退避」——那比「还没到点」
    // 具体，两个都成立时用具体的那句。
    if (!isBackingOff(endpoint) && !isDue(endpoint)) {
      results.push(skipped(endpoint.id, "not_due"));
      continue;
    }
    results.push(
      Date.now() >= deadline
        ? skipped(endpoint.id, "out_of_time")
        : await collectEndpoint(endpoint.id),
    );
  }
  return results;
}

function skipped(
  endpointId: string,
  because: NonNullable<AcquisitionResult["skippedBecause"]>,
): AcquisitionResult {
  return {
    endpointId,
    status: "skipped",
    newContentCount: 0,
    seenContentCount: 0,
    queuedCount: 0,
    skippedBecause: because,
  };
}

/** 推来的一条内容。必须带正文——只推地址的推送是不完整的推送（ADR 0015）。 */
export type PushedEntry = {
  externalId: unknown;
  title: unknown;
  author?: unknown;
  originUrl: unknown;
  body: unknown;
  publishedAt?: unknown;
  /** 平台自带的热度（点赞、评论数一类）。Radar 不理解它，只当一个数。 */
  hotness?: unknown;
};

/**
 * 需要登录态的平台 Radar 够不着，由用户自己的 Agent 采完推来（ADR 0011）。
 * Radar 不写登录态适配器、不保管任何登录态——推来的内容和自采的走同一条路：
 * 同样按 external_id 去重、同样存正文快照、同样入队。
 */
export function acceptPushedEntries(endpointId: string, entries: PushedEntry[]): AcquisitionResult {
  const endpoint = getEndpoint(endpointId);
  if (!endpoint) throw new UnknownEndpointError(endpointId);
  if (!isEnabled(endpoint)) throw new EndpointNotAcceptingPushError(endpointId, "已经停用了");
  if (endpoint.channelConfigState !== "unlocked_by_config") {
    throw new EndpointNotAcceptingPushError(endpointId, "所在渠道由 Radar 自采，不收推送");
  }
  if (entries.length === 0) throw new EmptyPushError();

  const feedEntries = entries.map(toFeedEntry);
  const pushedAt = new Date().toISOString();

  const created = inTransaction(() => {
    const count = persistBatch(endpointId, feedEntries, pushedAt);
    // 推送只记一件事：最后一次收到推送是什么时候。它不是一次采集尝试，不进
    // 采集历史；久未推送是这个分工的代价，不是故障，所以也不碰失败计数与退避。
    database()
      .prepare("UPDATE endpoints SET last_push_at = ? WHERE id = ?")
      .run(pushedAt, endpointId);
    return count;
  });

  return {
    endpointId,
    status: "success",
    newContentCount: created,
    seenContentCount: feedEntries.length,
    queuedCount: enqueueForAllBriefs(),
  };
}

/** 把一批内容落进库里，返回其中新出现的条数。自采与推送共用。 */
function persistBatch(endpointId: string, entries: FeedEntry[], seenAt: string): number {
  let created = 0;
  for (const entry of entries) {
    if (persistEntry(endpointId, entry, seenAt) === "created") created += 1;
  }
  return created;
}

function toFeedEntry(entry: PushedEntry): FeedEntry {
  const externalId = text(entry.externalId);
  if (!externalId) throw new PushMissingExternalIdError();
  const body = text(entry.body);
  if (!body) throw new PushMissingBodyError(externalId);
  const originUrl = text(entry.originUrl);
  if (!originUrl) throw new PushMissingOriginUrlError(externalId);
  const title = text(entry.title);
  if (!title) throw new PushMissingTitleError(externalId);
  return {
    externalId,
    title,
    author: text(entry.author) || null,
    originUrl,
    body,
    publishedAt: text(entry.publishedAt) || null,
    hotness:
      typeof entry.hotness === "number" && Number.isFinite(entry.hotness)
        ? entry.hotness
        : undefined,
    // 只留契约里那几个字段。Agent 夹带的别的东西一律不落盘——Radar 里不出现
    // 任何登录态凭据（ADR 0011）。
    rawPayload: JSON.stringify({ externalId, title, author: text(entry.author) || null, originUrl, body }),
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export class EmptyPushError extends RadarDomainError {
  constructor() {
    super("这次推送里一条内容都没有。", 400);
  }
}

export class EndpointNotAcceptingPushError extends RadarDomainError {
  constructor(endpointId: string, because: string) {
    super(`采集端点 ${endpointId} ${because}。`, 409);
  }
}

export class PushMissingExternalIdError extends RadarDomainError {
  constructor() {
    super("每条推送都要带 externalId，那是去重的依据。", 400);
  }
}

export class PushMissingBodyError extends RadarDomainError {
  constructor(externalId: string) {
    super(`推送 ${externalId} 没带正文。只推地址不算完整的推送。`, 400);
  }
}

export class PushMissingTitleError extends RadarDomainError {
  constructor(externalId: string) {
    super(`推送 ${externalId} 没带标题。`, 400);
  }
}

export class PushMissingOriginUrlError extends RadarDomainError {
  constructor(externalId: string) {
    super(`推送 ${externalId} 没带原文地址。`, 400);
  }
}
