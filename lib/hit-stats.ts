import { database } from "./database.js";

/**
 * 命中统计：纯计数，不读内容。Agent 依据这份统计自行修订公式——它改的是
 * 顺序，不是判断标准，所以这里数的是「进过队列 / 被哪条信号加过分」与
 * 「后来判成什么」。
 */
export type SignalHitStats = {
  /** 这条依据算在哪一版公式头上。没下发过公式那段是 `default`。 */
  strategyId: string;
  signal: string;
  /** 进过工作包、且被这条信号加过分的代次数。 */
  scored: number;
  judged: number;
  relevant: number;
};

export type EndpointHitStats = {
  endpointId: string;
  endpointName: string;
  queued: number;
  judged: number;
  relevant: number;
};

export function listSignalHitStats(briefId: string): SignalHitStats[] {
  return database()
    .prepare(
      `SELECT hit.strategy_id AS strategyId, signal,
         COUNT(*) AS scored,
         SUM(CASE WHEN judgment.id IS NULL THEN 0 ELSE 1 END) AS judged,
         SUM(COALESCE(judgment.relevant, 0)) AS relevant
       FROM queue_entry_signals AS hit
       JOIN queue_entries AS entry ON entry.id = hit.queue_entry_id
       LEFT JOIN judgments AS judgment ON judgment.queue_entry_id = entry.id
       WHERE entry.brief_id = ?
       GROUP BY hit.strategy_id, signal ORDER BY hit.strategy_id, signal`,
    )
    .all(briefId) as SignalHitStats[];
}

/** 端点在这条 Brief 的命中口径。算分时的历史命中率也读这一份，不另起一套。 */
export function listEndpointHitStats(briefId: string): EndpointHitStats[] {
  return database()
    .prepare(
      `SELECT content.endpoint_id AS endpointId, endpoint.name AS endpointName,
         COUNT(*) AS queued,
         SUM(CASE WHEN judgment.id IS NULL THEN 0 ELSE 1 END) AS judged,
         SUM(COALESCE(judgment.relevant, 0)) AS relevant
       FROM queue_entries AS entry
       JOIN source_contents AS content ON content.id = entry.source_content_id
       JOIN endpoints AS endpoint ON endpoint.id = content.endpoint_id
       LEFT JOIN judgments AS judgment ON judgment.queue_entry_id = entry.id
       WHERE entry.brief_id = ?
       GROUP BY content.endpoint_id ORDER BY content.endpoint_id`,
    )
    .all(briefId) as EndpointHitStats[];
}
