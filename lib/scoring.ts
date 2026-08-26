import { listEndpointHitStats } from "./hit-stats.js";
import { signals } from "./signals.js";
import type { StrategyFormula } from "./strategy.js";

export type PendingContent = {
  /** 不可变的队列代次 id。`radar judge` 消费它，代次唯一约束挡下重复写回。 */
  queueEntryId: string;
  sourceContentId: string;
  endpointId: string;
  endpointName: string;
  title: string;
  body: string;
  originUrl: string;
  publishedAt: string | null;
  acquiredAt: string;
  queuedAt: string;
};

export type CandidateRow = {
  queue_entry_id: string;
  source_content_id: string;
  endpoint_id: string;
  endpoint_name: string;
  title: string;
  body: string;
  origin_url: string;
  published_at: string | null;
  acquired_at: string;
  queued_at: string;
  hotness: number;
};

export type ScoredCandidate = {
  content: PendingContent;
  score: number;
  contributions: Record<string, number>;
};

/**
 * 按策略给每条候选算分。信号只取 Radar 自己就有的机械事实——Radar 全程不理解
 * 内容：关键词命中是子串匹配，热度是平台给的一个数，命中率是数出来的。
 *
 * 分数只决定顺序。再低的分也照样在队列里——只排序不丢弃（ADR 0010）。
 */
export function scoreCandidates(
  briefId: string,
  candidates: CandidateRow[],
  formula: StrategyFormula,
  now = new Date(),
): ScoredCandidate[] {
  const hitRates = endpointHitRates(briefId);

  return candidates.map((row) => {
    const contributions: Record<string, number> = {
      [signals.freshness]: formula.freshnessWeight * decay(row, formula.freshnessHalfLifeHours, now),
      [signals.endpointWeight]: formula.endpointWeights[row.endpoint_id] ?? 0,
      // 不归一化：不同平台的热度本来就不是一个量纲，怎么换算是 Agent 写在
      // 公式里的判断，不该由 Radar 替它做主。
      [signals.hotness]: formula.hotnessWeight * row.hotness,
      [signals.hitRate]: formula.hitRateWeight * (hitRates.get(row.endpoint_id) ?? 0),
    };

    const haystack = `${row.title}\n${row.body}`.toLowerCase();
    for (const keyword of formula.keywords) {
      if (haystack.includes(keyword.term.toLowerCase())) {
        contributions[signals.keyword(keyword.term)] = keyword.weight;
      }
    }

    const score = Object.values(contributions).reduce((total, value) => total + value, 0);
    return { content: toPendingContent(row), score, contributions };
  });
}

/** 新鲜度：按半衰期指数衰减，1 是刚出炉。 */
function decay(row: CandidateRow, halfLifeHours: number, now: Date): number {
  const at = Date.parse(row.published_at ?? row.acquired_at);
  const ageHours = Math.max(0, (now.getTime() - at) / 3_600_000);
  return Math.pow(0.5, ageHours / halfLifeHours);
}

/**
 * 该端点在本 Brief 的历史命中率：判过的里面有多少被判为相关。纯计数，不读内容。
 * 一条都没判过的端点算 0——没有历史就没有依据，不是「不好」。
 */
function endpointHitRates(briefId: string): Map<string, number> {
  return new Map(
    listEndpointHitStats(briefId).map((row) => [
      row.endpointId,
      row.judged === 0 ? 0 : row.relevant / row.judged,
    ]),
  );
}

function toPendingContent(row: CandidateRow): PendingContent {
  return {
    queueEntryId: row.queue_entry_id,
    sourceContentId: row.source_content_id,
    endpointId: row.endpoint_id,
    endpointName: row.endpoint_name,
    title: row.title,
    body: row.body,
    originUrl: row.origin_url,
    publishedAt: row.published_at,
    acquiredAt: row.acquired_at,
    queuedAt: row.queued_at,
  };
}
