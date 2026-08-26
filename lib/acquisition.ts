import { randomUUID } from "node:crypto";
import { database, inTransaction } from "./database.js";
import {
  getEndpoint,
  isBackingOff,
  isCollectable,
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
  skippedBecause?: "already_collecting" | "backing_off" | "not_collectable";
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
  const claimed = db.prepare(
    `UPDATE endpoints SET collecting_since = ?
     WHERE id = ? AND (collecting_since IS NULL OR collecting_since < ?)`,
  ).run(startedAt, endpointId, staleBefore(startedAt));
  if (claimed.changes === 0) return skipped(endpointId, "already_collecting");

  db.prepare(
    "INSERT INTO acquisition_runs (id, endpoint_id, status, started_at) VALUES (?, ?, 'running', ?)",
  ).run(runId, endpointId, startedAt);

  try {
    const feed = await fetchFeed(endpoint.url);
    const completedAt = new Date().toISOString();
    const counts = inTransaction(() => {
      let created = 0;
      for (const entry of feed.entries) {
        if (persistEntry(endpointId, entry, completedAt) === "created") created += 1;
      }
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

function whyNotNow(
  endpoint: Endpoint,
  force: boolean,
): AcquisitionResult["skippedBecause"] | null {
  if (!isCollectable(endpoint)) return "not_collectable";
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
function persistEntry(
  endpointId: string,
  entry: FeedEntry,
  seenAt: string,
): "created" | "seen" {
  const db = database();
  const existing = db
    .prepare("SELECT id FROM source_contents WHERE endpoint_id = ? AND external_id = ?")
    .get(endpointId, entry.externalId) as { id: string } | undefined;

  if (existing) {
    db.prepare("UPDATE source_contents SET last_seen_at = ? WHERE id = ?").run(seenAt, existing.id);
    return "seen";
  }

  db.prepare(
    `INSERT INTO source_contents
      (id, endpoint_id, external_id, title, body, origin_url, published_at,
       raw_json, acquired_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    endpointId,
    entry.externalId,
    entry.title,
    entry.body,
    entry.originUrl,
    entry.publishedAt,
    entry.rawPayload,
    seenAt,
    seenAt,
  );
  return "created";
}

function staleBefore(now: string): string {
  return new Date(Date.parse(now) - staleCollectionSeconds * 1_000).toISOString();
}

/** 把所有端点催一遍。逐个来——退避与防重入照旧由 collectEndpoint 把关。 */
export async function collectAllEndpoints(): Promise<AcquisitionResult[]> {
  const results: AcquisitionResult[] = [];
  for (const endpoint of listEndpoints()) {
    results.push(await collectEndpoint(endpoint.id));
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
